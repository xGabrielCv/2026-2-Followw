from datetime import date

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.account import Account
from api.anonymous import anonymous_key
from api.db.main import Database
from api.db.models import ActiveUser


async def start_account(account: Account, db: Database, author: str | None) -> None:
    """Confere a senha (logando, se não houver sessão), renova o perfil e conta o uso.

    O uso conta pela chave do aparelho, que não tem relação com a matrícula.
    """
    await account.profile(refresh=True)
    if author is not None:
        await db.write(lambda session: record_activity(session, author))


def periods(day: date) -> list[str]:
    year, week, _ = day.isocalendar()
    return [f"d:{day.isoformat()}", f"w:{year}-W{week:02d}", f"m:{day:%Y-%m}"]


async def record_activity(
    session: AsyncSession, author: str, day: date | None = None
) -> None:
    """Uma chave por período: conta alunos únicos sem ligar um dia ao outro."""
    rows = [
        {"period": period, "key": anonymous_key(author, f"active:{period}")}
        for period in periods(day or academic_calendar.today())
    ]
    await session.execute(insert(ActiveUser).values(rows).on_conflict_do_nothing())
