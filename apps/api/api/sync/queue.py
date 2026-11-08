import asyncio
import base64
import hashlib
import logging
import time
from collections.abc import AsyncGenerator, Coroutine
from functools import cache
from typing import Annotated, Any, Protocol

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, Header, HTTPException, Request, status
from pydantic import ValidationError
from qstash import AsyncQStash, Receiver
from qstash.errors import QStashError, SignatureError
from qstash.message import BatchRequest

from api.anonymous import anonymous_key
from api.cookies import derive_key
from api.core.config import settings
from api.logger import event, operation
from api.sync import Job

JOBS_URL = f"{settings.public_url.rstrip('/')}/jobs"

# Agendar nunca segura a resposta por mais que isso.
_PUBLISH_TIMEOUT = 3
# Cada job loga numa sessão própria: o limite só poupa o CAS de rajadas.
_PARALLELISM = 4
# Espera da retentativa das tarefas que falharam.
_RETRY_DELAY = 60
# O mesmo job de novo nesse intervalo é descartado, como no QStash.
_DEDUPLICATION = 600


class JobQueue(Protocol):
    async def enqueue(self, *jobs: Job) -> None: ...

    async def aclose(self) -> None: ...


class QStashQueue:
    """Publica os jobs no QStash, que os entrega de volta em `POST /jobs`."""

    def __init__(self) -> None:
        self._client: AsyncQStash | None = None

    async def enqueue(self, *jobs: Job) -> None:
        """Agenda os jobs. Uma falha ao agendar não chega a quem chamou."""
        if not jobs:
            return

        # Respostas do cache não precisam construir o cliente HTTP/TLS da fila.
        if self._client is None:
            self._client = AsyncQStash(
                settings.qstash_token or "", base_url=settings.qstash_url
            )
        messages: list[BatchRequest] = [_message(job) for job in jobs]
        try:
            with operation("queue.publish", job_count=len(jobs)):
                async with asyncio.timeout(_PUBLISH_TIMEOUT):
                    await self._client.message.batch(messages)
        except QStashError, httpx.HTTPError, TimeoutError:
            # Sem o job, o cache só segue vencido até o próximo acesso agendar outro.
            event("queue.publish_abandoned", level=logging.WARNING, job_count=len(jobs))

    async def aclose(self) -> None:
        # O AsyncQStash não expõe como fechar o próprio httpx.AsyncClient.
        if self._client is not None:
            await self._client.http._client.aclose()


# Estado da fila local: tarefas vivas (o event loop só guarda referência fraca),
# a deduplicação e o limite de jobs simultâneos por matrícula.
local_tasks: set[asyncio.Task[None]] = set()
_local_seen: dict[str, float] = {}
_local_limits: dict[str, asyncio.Semaphore] = {}


class LocalQueue:
    """Roda os jobs no próprio processo, em segundo plano: o modo 100% local, sem QStash."""

    async def enqueue(self, *jobs: Job) -> None:
        now = time.monotonic()
        for job in jobs:
            if now - _local_seen.get(job.key, -_DEDUPLICATION) < _DEDUPLICATION:
                continue
            _local_seen[job.key] = now
            self._spawn(self._execute(job))

    async def aclose(self) -> None:
        return None

    @staticmethod
    def _spawn(coroutine: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(coroutine)
        local_tasks.add(task)
        task.add_done_callback(local_tasks.discard)

    async def _execute(self, job: Job) -> None:
        # Import tardio: o runner dos jobs depende desta fila.
        from api.db.main import Database, async_session
        from api.sync.router import execute

        if job.attempt > 1:
            await asyncio.sleep(_RETRY_DELAY)
        limit = _local_limits.setdefault(
            job.registration, asyncio.Semaphore(_PARALLELISM)
        )
        async with limit:
            try:
                await execute(job, Database(async_session), self)
            except Exception:  # noqa: BLE001 — sem quem receba o erro, só resta logar
                event("queue.local_job_failed", level=logging.ERROR)


async def get_job_queue() -> AsyncGenerator[JobQueue]:
    if settings.job_queue == "local":
        yield LocalQueue()
        return
    # Um client por requisição: o pool do httpx fica preso ao event loop que o abriu.
    queue = QStashQueue()
    try:
        yield queue
    finally:
        await queue.aclose()


JobQueueDep = Annotated[JobQueue, Depends(get_job_queue)]


async def get_job(request: Request, upstash_signature: Annotated[str, Header()]) -> Job:
    """O job entregue pelo QStash, depois de conferir a assinatura."""
    body = await request.body()
    try:
        _receiver().verify(
            signature=upstash_signature,
            body=body.decode(errors="replace"),
            url=JOBS_URL,
        )
    except SignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
        )

    try:
        return decode_job(body)
    except InvalidToken, ValidationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job"
        )


JobDep = Annotated[Job, Depends(get_job)]


def encode_job(job: Job) -> str:
    """O corpo da mensagem, cifrado: a Upstash não enxerga a credencial do usuário."""
    return _cipher().encrypt(job.model_dump_json().encode()).decode()


def decode_job(body: bytes) -> Job:
    return Job.model_validate_json(_cipher().decrypt(body))


def _message(job: Job) -> BatchRequest:
    message: BatchRequest = {
        "url": JOBS_URL,
        "body": encode_job(job),
        "content_type": "text/plain",
        # O mesmo job de novo em até 10 minutos é descartado. Em hash: o QStash
        # recusa ':'.
        "deduplication_id": hashlib.sha256(job.key.encode()).hexdigest(),
        "flow_control": {
            # A Upstash não vê a matrícula: só uma chave anônima por aluno.
            "key": f"sigaa-{anonymous_key(job.author or job.key, 'jobs')[:32]}",
            "parallelism": _PARALLELISM,
        },
    }
    if job.attempt > 1:
        message["delay"] = _RETRY_DELAY
    return message


@cache
def _receiver() -> Receiver:
    return Receiver(
        current_signing_key=settings.qstash_current_signing_key or "",
        next_signing_key=settings.qstash_next_signing_key or "",
    )


@cache
def _cipher() -> Fernet:
    # Chave própria dos jobs, derivada do segredo que assina os cookies.
    return Fernet(base64.urlsafe_b64encode(derive_key("followw:jobs")))
