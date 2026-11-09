from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from api.community_limits import KEY, CommunityLimits, read_limits
from api.db.main import DatabaseDep
from api.db.models import SystemText
from api.modules.admin import auth
from api.modules.admin.service import log

router = APIRouter(dependencies=[auth.require_permission("configure")])


@router.get("")
async def get_limits(db: DatabaseDep) -> CommunityLimits:
    return await db.read(read_limits)


@router.put("")
async def set_limits(
    body: CommunityLimits, request: Request, db: DatabaseDep
) -> CommunityLimits:
    async def write(session: AsyncSession):
        row = await session.get(SystemText, KEY)
        if row is None:
            session.add(SystemText(key=KEY, value=body.model_dump_json()))
        else:
            row.value = body.model_dump_json()
        await log(
            session,
            "community.limits",
            detail=body.model_dump_json(),
            actor=request.state.admin,
        )
        return body

    return await db.write(write)
