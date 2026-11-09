import logging
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Annotated, Literal

import httpx
from fastapi import Depends, HTTPException, status
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.exc import SQLAlchemyError
from unb_browser import Campus, DailyMenu, UnbBrowser, UnbBrowserError

from api.cache import NO_DIRECTIVES, CacheControl, is_stale
from api.db.main import SessionmakerDep
from api.logger import event
from api.modules.public_restaurant.repository import RestaurantRepository
from api.resilience import CircuitOpenError, OriginGuard, count

RESTAURANT_MENU_TTL = timedelta(days=5)
BRASILIA = timezone(timedelta(hours=-3))
_MENU = TypeAdapter(tuple[DailyMenu, ...])
Meal = Literal["breakfast", "lunch", "dinner"]
# Uma consulta à UnB por campus, não uma por aluno; a origem fora do ar abre o circuito.
RESTAURANT_ORIGIN = OriginGuard(
    "ru", max_concurrent=2, failure_threshold=3, reset_seconds=120
)


def today() -> date:
    return datetime.now(BRASILIA).date()


class RestaurantService:
    def __init__(
        self,
        sessionmaker: SessionmakerDep,
    ) -> None:
        self._sessionmaker = sessionmaker

    async def get_menu(
        self,
        campus: Campus,
        cache: CacheControl = NO_DIRECTIVES,
        *,
        day: date | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        meal: Meal | None = None,
    ) -> tuple[DailyMenu, ...]:
        if day is not None:
            start_date = end_date = day
        elif start_date is None and end_date is None:
            current = today()
            start_date = current - timedelta(days=current.weekday())
            end_date = start_date + timedelta(days=6)
        # Sem intervalo fechado, o limite que falta completa uma semana.
        elif end_date is None:
            end_date = start_date + timedelta(days=6)
        elif start_date is None:
            start_date = end_date - timedelta(days=6)
        days = await self._load_menu(campus, start_date, end_date, cache)
        if meal is None:
            return days
        return tuple(
            DailyMenu(date=item.date, **{meal: getattr(item, meal)}) for item in days
        )

    async def _load_menu(
        self, campus: Campus, start: date, end: date, cache: CacheControl
    ) -> tuple[DailyMenu, ...]:
        cached: tuple[DailyMenu, ...] = ()
        synced_at: datetime | None = None
        try:
            async with self._sessionmaker() as session:
                repository = RestaurantRepository(session)
                rows = await repository.get(campus, start, end)
                cached = _MENU.validate_python(rows, from_attributes=True)
                synced_at = await repository.synced_at(campus)
        except SQLAlchemyError, OSError, TimeoutError, ValidationError:
            event("restaurant.cache_read_failed", level=logging.WARNING)

        if (
            cached
            and synced_at is not None
            and (
                cache.only_if_cached
                or not (
                    is_stale(synced_at, RESTAURANT_MENU_TTL)
                    or cache.revalidate(synced_at)
                )
            )
        ):
            cache.served(synced_at)
            return cached
        if cache.only_if_cached:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Not cached"
            )

        try:
            days, fetched_at, saved = await RESTAURANT_ORIGIN.fetch(
                f"menu:{campus}", lambda: self._refresh(campus)
            )
        except (UnbBrowserError, httpx.HTTPError, CircuitOpenError) as error:
            # Cache vencido de outras datas não serve: sem o intervalo pedido, 502.
            # Se foi o cliente quem pediu a revalidação, só o `stale-if-error` libera o cache.
            if (
                not cached
                or synced_at is None
                or (cache.revalidate(synced_at) and not cache.accepts_stale(synced_at))
            ):
                raise UnbBrowserError("Site do RU indisponível.") from error
            event("restaurant.stale_fallback", level=logging.WARNING)
            count("origin.ru.stale_served")
            cache.served(synced_at)
            return cached

        cache.served(fetched_at)
        if saved:
            try:
                async with self._sessionmaker() as session:
                    rows = await RestaurantRepository(session).get(campus, start, end)
                    return _MENU.validate_python(rows, from_attributes=True)
            except SQLAlchemyError, OSError, TimeoutError, ValidationError:
                event("restaurant.cache_write_failed", level=logging.WARNING)
        # Revalida para marcar todos os campos como definidos, igual ao que vem do banco.
        return _MENU.validate_python(
            _MENU.dump_python(tuple(d for d in days if start <= d.date <= end))
        )

    async def _refresh(
        self, campus: Campus
    ) -> tuple[tuple[DailyMenu, ...], datetime, bool]:
        """Consulta a UnB e grava no banco: roda uma vez por campus, mesmo com muitos pedidos."""
        async with UnbBrowser() as browser:
            days = await browser.restaurant.get_menu(campus)
        now = datetime.now(UTC)
        try:
            async with self._sessionmaker() as session:
                await RestaurantRepository(session).save(campus, days, now)
                await session.commit()
        except SQLAlchemyError, OSError, TimeoutError, ValidationError:
            event("restaurant.cache_write_failed", level=logging.WARNING)
            return tuple(days), now, False
        return tuple(days), now, True


RestaurantServiceDep = Annotated[RestaurantService, Depends()]
