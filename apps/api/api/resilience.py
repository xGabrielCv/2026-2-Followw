"""Proteção das consultas a fontes externas públicas (RU, SIGAA público).

- single-flight: pedidos iguais e simultâneos esperam a mesma consulta (milhares de alunos abrindo o
  cardápio no minuto em que o cache vence geram uma consulta à UnB, não milhares);
- limite global de consultas simultâneas por origem;
- circuit breaker: depois de falhas seguidas, para de bater na origem por um tempo (os pedidos usam
  o cache vencido ou falham rápido) e testa de novo com uma única consulta;
- backoff exponencial com jitter nas retentativas.

O estado vale por processo. Com várias réplicas cada uma consulta no máximo uma vez por chave; o
catálogo público pesado é atualizado por tarefa agendada única (`scripts/update_data.py`).
Só dado público passa por aqui: nada pessoal entra em chave, cache ou contador.
"""

import asyncio
import random
import time
from collections.abc import Awaitable, Callable

_counters: dict[str, int] = {}
# caches e guardas vivos: `reset_all` devolve tudo ao zero (testes não herdam estado do anterior)
_caches: list[TTLCache] = []
_breakers: list[CircuitBreaker] = []


def count(name: str, amount: int = 1) -> None:
    _counters[name] = _counters.get(name, 0) + amount


def counters() -> dict[str, int]:
    return dict(_counters)


def reset_counters() -> None:
    _counters.clear()


def reset_all() -> None:
    _counters.clear()
    for cache in _caches:
        cache.clear()
    for breaker in _breakers:
        breaker.success()


class SingleFlight:
    """Uma execução por chave; quem chega durante ela recebe o mesmo resultado (ou o mesmo erro)."""

    def __init__(self) -> None:
        self._running: dict[str, asyncio.Future] = {}

    async def run[T](self, key: str, factory: Callable[[], Awaitable[T]]) -> T:
        running = self._running.get(key)
        if running is not None:
            count("single_flight.shared")
            return await asyncio.shield(running)
        future: asyncio.Future[T] = asyncio.get_running_loop().create_future()
        self._running[key] = future
        try:
            result = await factory()
        except BaseException as error:
            # `shield` + exceção marcada como consumida: sem aviso se ninguém esperava.
            future.set_exception(error)
            future.exception()
            raise
        else:
            future.set_result(result)
            return result
        finally:
            del self._running[key]


class CircuitOpenError(Exception):
    """A origem falhou várias vezes seguidas; nova tentativa só depois do tempo de espera."""


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        *,
        failure_threshold: int = 5,
        reset_seconds: float = 60,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.name = name
        self._threshold = failure_threshold
        self._reset = reset_seconds
        self._clock = clock
        self._failures = 0
        self._opened_at: float | None = None
        self._probing = False
        _breakers.append(self)

    @property
    def state(self) -> str:
        if self._opened_at is None:
            return "closed"
        if self._clock() - self._opened_at >= self._reset:
            return "half_open"
        return "open"

    def allow(self) -> bool:
        state = self.state
        if state == "closed":
            return True
        if state == "half_open" and not self._probing:
            self._probing = True  # uma única consulta de teste por vez
            return True
        count(f"breaker.{self.name}.rejected")
        return False

    def success(self) -> None:
        self._failures, self._opened_at, self._probing = 0, None, False

    def failure(self) -> None:
        self._probing = False
        self._failures += 1
        if self._failures >= self._threshold or self._opened_at is not None:
            if self._opened_at is None:
                count(f"breaker.{self.name}.opened")
            self._opened_at = self._clock()

    async def call[T](self, factory: Callable[[], Awaitable[T]]) -> T:
        if not self.allow():
            raise CircuitOpenError(self.name)
        try:
            result = await factory()
        except BaseException:
            self.failure()
            raise
        self.success()
        return result


def backoff_delay(attempt: int, *, base: float = 0.5, cap: float = 30) -> float:
    """Espera "full jitter": sorteia entre 0 e min(cap, base * 2^tentativa)."""
    return random.uniform(0, min(cap, base * 2**attempt))


async def retry[T](
    factory: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    retry_on: tuple[type[BaseException], ...] = (Exception,),
    base: float = 0.5,
    cap: float = 30,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    for attempt in range(attempts):
        try:
            return await factory()
        except retry_on:
            if attempt == attempts - 1:
                raise
            count("retry.attempt")
            await sleep(backoff_delay(attempt, base=base, cap=cap))
    raise AssertionError("inalcançável")  # pragma: no cover


class TTLCache:
    """Cache em memória de dado público com validade, e cópia vencida como rede de segurança.

    Dentro do `ttl` a resposta sai do cache sem consultar a origem. Passado o `ttl`, uma nova
    consulta (via `loader`, que deve passar pelo `OriginGuard`) renova; se ela falhar, a cópia vencida
    ainda serve até `ttl + stale_ttl` (stale-if-error). O estado vale por processo.
    """

    def __init__(
        self,
        ttl: float,
        stale_ttl: float = 0,
        *,
        max_entries: int = 256,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl, self._stale, self._max, self._clock = (
            ttl,
            stale_ttl,
            max_entries,
            clock,
        )
        self._store: dict[str, tuple[object, float]] = {}
        _caches.append(self)

    def clear(self) -> None:
        self._store.clear()

    async def get[T](self, key: str, loader: Callable[[], Awaitable[T]]) -> T:
        entry = self._store.get(key)
        age = self._clock() - entry[1] if entry else None
        if entry is not None and age is not None and age < self._ttl:
            count("cache.hit")
            return entry[0]  # type: ignore[return-value]
        try:
            value = await loader()
        except Exception:
            if entry is not None and age is not None and age < self._ttl + self._stale:
                count("cache.stale_served")
                return entry[0]  # type: ignore[return-value]
            raise
        if len(self._store) >= self._max and key not in self._store:
            del self._store[next(iter(self._store))]  # a mais antiga
        self._store[key] = (value, self._clock())
        count("cache.miss")
        return value


class OriginGuard:
    """Junta tudo para uma origem: single-flight por chave, limite global e circuit breaker."""

    def __init__(self, name: str, *, max_concurrent: int = 4, **breaker: float) -> None:
        self.name = name
        self.flights = SingleFlight()
        self.breaker = CircuitBreaker(name, **breaker)
        self._slots = asyncio.Semaphore(max_concurrent)

    async def fetch[T](self, key: str, factory: Callable[[], Awaitable[T]]) -> T:
        async def guarded() -> T:
            async with self._slots:
                count(f"origin.{self.name}.calls")
                return await self.breaker.call(factory)

        return await self.flights.run(f"{self.name}:{key}", guarded)
