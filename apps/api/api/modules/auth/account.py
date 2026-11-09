from datetime import date

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.account import Account
from api.anonymous import anonymous_key
from api.db.context import apply_context, set_context
from api.db.main import Database
from api.db.models import ActiveUser
from api.flags import flags


async def start_account(
    account: Account, db: Database, usage: dict[str, str] | None
) -> None:
    """Confere a senha (logando, se não houver sessão), renova o perfil e conta o uso.

    O uso conta por chaves aleatórias de período (dia, semana, mês), sem relação entre si nem com a matrícula.
    """
    await account.profile(refresh=True)
    if usage is not None and (await db.read(flags))["telemetry"]:
        await db.write(lambda session: record_activity(session, usage))


def periods(day: date) -> list[str]:
    year, week, _ = day.isocalendar()
    return [f"d:{day.isoformat()}", f"w:{year}-W{week:02d}", f"m:{day:%Y-%m}"]


async def record_activity(
    session: AsyncSession, usage: dict[str, str], day: date | None = None
) -> None:
    """Uma chave aleatória por período: conta alunos únicos sem ligar um dia ao outro."""
    set_context(scope="usage_record")
    await apply_context(session)
    rows = [
        {"period": period, "key": anonymous_key(usage[period[0]], f"active:{period}")}
        for period in periods(day or academic_calendar.today())
    ]
    await session.execute(insert(ActiveUser).values(rows).on_conflict_do_nothing())
