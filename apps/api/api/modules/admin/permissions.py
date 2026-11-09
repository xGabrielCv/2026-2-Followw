from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

Role = Literal["moderator", "administrator", "owner"]
Permission = Literal[
    "moderate",
    "support",
    "operations",
    "configure",
    "accounts",
    "audit",
    "maintenance",
    "owner",
]
PERMISSIONS: dict[str, frozenset[str]] = {
    "moderator": frozenset({"moderate", "support"}),
    "administrator": frozenset(
        {"moderate", "support", "operations", "configure", "accounts", "audit"}
    ),
    "owner": frozenset(
        {
            "moderate",
            "support",
            "operations",
            "configure",
            "accounts",
            "audit",
            "maintenance",
            "owner",
        }
    ),
}


@dataclass(frozen=True)
class Principal:
    id: UUID
    username: str
    role: Role
    session_id: UUID
    authenticated_at: datetime


def allowed(role: str, permission: Permission) -> bool:
    return permission in PERMISSIONS.get(role, frozenset())
