import logging
from collections.abc import Awaitable, Callable

import httpx
from fastapi import APIRouter, HTTPException, status
from sigaa_client import AuthenticationFailed, ClassroomNotFound, SigaaError

from api.db.main import Database, DatabaseDep
from api.logger import event, operation
from api.modules.me.sharing import fetch_and_share_statistics
from api.sigaa import SigaaConnection
from api.sync import Job
from api.sync.queue import JobDep, JobQueue, JobQueueDep

router = APIRouter()

# Falhas da origem: uma nova tentativa pode resolver.
ORIGIN_ERRORS = (SigaaError, httpx.HTTPError)

type Task = Callable[[SigaaConnection, Database, str | None], Awaitable[None]]

TASKS: dict[str, Task] = {"share_statistics": fetch_and_share_statistics}
# A primeira tentativa e uma retentativa.
MAX_ATTEMPTS = 2


@router.post("", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def run_job(job: JobDep, db: DatabaseDep, queue: JobQueueDep) -> None:
    """Destino dos jobs do QStash: loga numa sessão própria, roda a tarefa e sai."""
    if job.task not in TASKS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown task"
        )
    await execute(job, db, queue)


async def execute(job: Job, db: Database, queue: JobQueue) -> None:
    with operation("job", attempt=job.attempt, task=job.task):
        sigaa = SigaaConnection(job.credentials)
        retry = False
        try:
            await TASKS[job.task](sigaa, db, job.author)
        except AuthenticationFailed:
            event("job.authentication_rejected")
        except ClassroomNotFound:
            event("job.discarded")
        except ORIGIN_ERRORS:
            event("job.retry_pending", level=logging.WARNING)
            retry = job.attempt < MAX_ATTEMPTS
        finally:
            await sigaa.aclose(logout=True)
        if retry:
            await queue.enqueue(job.model_copy(update={"attempt": job.attempt + 1}))
