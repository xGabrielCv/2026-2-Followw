"""Separa a comprovação acadêmica da operação comunitária, sem identidade no comprovante."""

import hashlib
import re
import secrets
import time
from datetime import UTC, datetime
from functools import cache
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import OctKey
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from starlette._utils import get_route_path

from api.anonymous import anonymous_key, resource_key, valid_author
from api.cache import NoStore
from api.cookies import (
    ACCESS_COOKIE_NAME,
    PROFILE_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    derive_key,
)
from api.db.context import set_context
from api.db.main import DatabaseDep
from api.modules.community.models import UsedCommunityPermission
from api.modules.community.quotas import reserve_upload
from api.rate_limit import publish_quota
from api.sigaa import SigaaConnectionDep

TTL_SECONDS = 120
_ID = r"[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}"
_CODE = r"[A-Za-z0-9]{3,16}"
_RULES = [
    ("POST", re.compile(rf"/forum(?:/{_ID}/replies)?")),
    ("DELETE", re.compile(rf"/forum/{_ID}(?:/replies/{_ID})?")),
    ("PATCH", re.compile(rf"/forum/{_ID}/resolved")),
    ("POST", re.compile(rf"/materials/{_CODE}")),
    ("DELETE", re.compile(rf"/materials/{_CODE}/{_ID}")),
    ("PUT", re.compile(rf"/groups/{_CODE}/[0-9]{{4}}\.[0-9]/[0-9A-Za-z]{{1,4}}")),
    ("POST", re.compile(r"/reviews")),
    ("PUT", re.compile(rf"/reviews/{_ID}")),
    ("DELETE", re.compile(rf"/reviews/{_ID}")),
    ("POST", re.compile(r"/tutorials")),
]


def permission_action(method: str, path: str) -> str:
    if not any(verb == method and pattern.fullmatch(path) for verb, pattern in _RULES):
        raise HTTPException(422, "Operação comunitária inválida.")
    return f"{method} {path}"


@cache
def _key() -> OctKey:
    return OctKey.import_key(derive_key("followw:community-permission:v1"))


def issue_permission(method: str, path: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"alg": "HS256", "typ": "JWT"},
        {
            "aud": "followw:community",
            "act": permission_action(method, path),
            "iat": now,
            "exp": now + TTL_SECONDS,
            "jti": secrets.token_hex(32),
        },
        _key(),
        algorithms=["HS256"],
    )


class PermissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["POST", "PUT", "PATCH", "DELETE"]
    path: str = Field(min_length=2, max_length=160)
    upload_key: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")

    @model_validator(mode="after")
    def upload_scope(self):
        uploading = (
            self.method == "POST"
            and re.fullmatch(rf"/materials/{_CODE}", self.path) is not None
        )
        if uploading != (self.upload_key is not None):
            raise ValueError(
                "Uma autorização de envio exige sua credencial por matéria."
            )
        return self


class PermissionResponse(BaseModel):
    token: str
    expires_in: int = TTL_SECONDS


router = APIRouter()


@router.post(
    "/community-permits",
    response_model=PermissionResponse,
    dependencies=[NoStore, publish_quota("community_permits", 240)],
)
async def issue_academic_permission(
    body: PermissionRequest, _: SigaaConnectionDep, db: DatabaseDep
) -> PermissionResponse:
    permission_action(body.method, body.path)
    if body.upload_key is not None:
        await reserve_upload(db, body.path.rsplit("/", 1)[1].upper(), body.upload_key)
    return PermissionResponse(token=issue_permission(body.method, body.path))


async def require_community_write(request: Request, db: DatabaseDep) -> None:
    if any(
        name in request.cookies
        for name in (ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, PROFILE_COOKIE_NAME)
    ):
        raise HTTPException(
            400, "Use uma autorização comunitária sem cookies acadêmicos."
        )
    token = request.headers.get("X-Followw-Permit")
    if not token:
        raise HTTPException(
            401, "Entre na conta para obter uma autorização comunitária."
        )
    action = permission_action(
        request.method, get_route_path(request.scope).rstrip("/")
    )
    try:
        if len(token) > 2048:
            raise ValueError
        claims = jwt.decode(token, _key(), algorithms=["HS256"]).claims
        if set(claims) != {"aud", "act", "iat", "exp", "jti"}:
            raise ValueError
        now = int(time.time())
        if claims["aud"] != "followw:community" or claims["act"] != action:
            raise ValueError
        if type(claims["iat"]) is not int or type(claims["exp"]) is not int:
            raise ValueError
        if not claims["iat"] <= now < claims["exp"] <= claims["iat"] + TTL_SECONDS:
            raise ValueError
        if not isinstance(claims["jti"], str) or not re.fullmatch(
            r"[0-9a-f]{64}", claims["jti"]
        ):
            raise ValueError
    except JoseError, ValueError, KeyError, TypeError:
        raise HTTPException(
            403, "Autorização inválida ou vencida. Tente novamente."
        ) from None
    parts = get_route_path(request.scope).strip("/").split("/")
    root = parts[0]
    author = valid_author(request.headers.get("X-Followw-Author"))
    context = {
        "scope": "community_write",
        "community_operation": f"{root}_{request.method.lower()}",
    }
    if author:
        context["author_key"] = resource_key(author)
    if root == "forum" and len(parts) > 1:
        context["forum_post"] = str(UUID(parts[1]))
        if author:
            context["legacy_author_key"] = anonymous_key(
                author, f"forum:{context['forum_post']}"
            )
        if "replies" in parts:
            context["community_operation"] = f"reply_{request.method.lower()}"
    if root == "materials":
        context["material_subject"] = parts[1].upper()
        if len(parts) > 2:
            context["material_id"] = str(UUID(parts[2]))
        if author:
            context["legacy_author_key"] = anonymous_key(
                author, f"material:{parts[1].upper()}"
            )
    if root == "tutorials" and author:
        context["legacy_author_key"] = anonymous_key(author, "tutorials")
    if root == "reviews" and len(parts) > 1:
        context["review_id"] = str(UUID(parts[1]))
    if root == "groups":
        context.update(
            group_subject=parts[1].upper(),
            group_semester=parts[2],
            group_number=parts[3],
        )
    set_context(**context)
    digest = hashlib.sha256(claims["jti"].encode()).hexdigest()

    async def consume(session):
        await session.execute(
            delete(UsedCommunityPermission).where(
                UsedCommunityPermission.expires_at <= datetime.now(UTC)
            )
        )
        return await session.scalar(
            insert(UsedCommunityPermission)
            .values(
                digest=digest, expires_at=datetime.fromtimestamp(claims["exp"], UTC)
            )
            .on_conflict_do_nothing()
            .returning(UsedCommunityPermission.digest)
        )

    if await db.write(consume) is None:
        raise HTTPException(403, "Autorização já utilizada. Tente novamente.")


CommunityWriteDep = Annotated[None, Depends(require_community_write)]
