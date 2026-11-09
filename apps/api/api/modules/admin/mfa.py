import hashlib
import hmac
import secrets
from datetime import UTC, datetime
from uuid import UUID

import pyotp


def totp_counter(
    secret: str, code: str, last: int, now: datetime | None = None
) -> int | None:
    totp = pyotp.TOTP(secret)
    current = totp.timecode(now or datetime.now(UTC))
    matched = None
    for counter in range(max(0, current - 1), current + 2):
        if (
            pyotp.utils.strings_equal(totp.generate_otp(counter), code)
            and counter > last
        ):
            matched = counter
    return matched


def recovery_hash(account_id: UUID, code: str) -> str:
    return hashlib.sha256(
        f"followw:admin-recovery:{account_id}:{code.strip().lower()}".encode()
    ).hexdigest()


def recovery_codes(account_id: UUID) -> tuple[list[str], list[str]]:
    codes = [secrets.token_hex(32) for _ in range(10)]
    return codes, [recovery_hash(account_id, code) for code in codes]


def consume_recovery(
    account_id: UUID, code: str, hashes: list[str]
) -> list[str] | None:
    digest = recovery_hash(account_id, code)
    match = next(
        (value for value in hashes if hmac.compare_digest(value, digest)), None
    )
    return [value for value in hashes if value != match] if match else None
