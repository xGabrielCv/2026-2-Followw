"""O que cada fonte faz. Lista fechada: a administração escolhe uma delas, nunca um comando."""

import asyncio
import hashlib
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from unb_browser import Campus

from api.modules.public_restaurant.service import RestaurantService
from api.modules.sync.service import Outcome

ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts" / "update_data.py"
DATA = ROOT / "packages" / "sigaa-client" / "data"
PROFESSORS = ROOT / ".local" / "data" / "professors.csv"
# Marca deixada pelo script de atualização; evita refazer na subida o que acabou de ser feito.
MARKER = ROOT / ".local" / "update.json"
_SECRET = re.compile(r"(://[^/\s:@]+:)[^@\s]+@")
_WINDOWS = sys.platform == "win32"
# CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
_WINDOWS_FLAGS = 0x00000200 | 0x08000000


def summarize(output: str) -> str:
    """Última linha útil, sem credenciais de URL e com tamanho limitado."""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    return _SECRET.sub(r"\1***@", lines[-1])[:300] if lines else "sem saída"


def legacy_last_update() -> datetime | None:
    try:
        value = json.loads(MARKER.read_text(encoding="utf-8"))["updated_at"]
        moment = datetime.fromisoformat(value)
    except OSError, ValueError, KeyError, TypeError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def catalog_files() -> list[Path]:
    files = sorted(DATA.glob("*.csv")) if DATA.exists() else []
    return files + ([PROFESSORS] if PROFESSORS.exists() else [])


def catalog_fingerprint() -> tuple[str, int]:
    digest = hashlib.sha256()
    records = 0
    for file in catalog_files():
        content = file.read_bytes()
        digest.update(file.name.encode() + b"\0" + hashlib.sha256(content).digest())
        if file.name == "classrooms.csv":
            records = max(content.count(b"\n") - 1, 0)
    return digest.hexdigest(), records


async def _kill_tree(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    if _WINDOWS:
        killer = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(process.pid),
            "/T",
            "/F",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await killer.wait()
    else:
        process.kill()
    await process.wait()


async def run_catalog(timeout: int) -> Outcome:
    """Roda o coletor público fora do processo da API: não bloqueia pedidos nem trava o loop."""
    if not SCRIPT.exists():
        return Outcome("skipped", error="Script de atualização indisponível aqui.")
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        str(SCRIPT),
        cwd=ROOT,
        env={**os.environ, "PYTHONUTF8": "1"},
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        # grupo próprio: o tempo limite encerra o coletor e os filhos, não a API
        creationflags=_WINDOWS_FLAGS if _WINDOWS else 0,
        start_new_session=not _WINDOWS,
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout)
    except TimeoutError:
        await _kill_tree(process)
        return Outcome("failed", error=f"Excedeu o limite de {timeout} segundos.")
    except asyncio.CancelledError:
        await _kill_tree(process)
        raise
    if process.returncode != 0:
        detail = summarize(output.decode("utf-8", "replace"))
        return Outcome("failed", error=f"Código {process.returncode}: {detail}")
    fingerprint, records = await asyncio.to_thread(catalog_fingerprint)
    return Outcome("success", records=records, fingerprint=fingerprint)


async def run_restaurant(
    sessionmaker: async_sessionmaker[AsyncSession], timeout: int
) -> Outcome:
    """Atualiza o cache do cardápio de cada campus pelo mesmo caminho dos pedidos."""
    service = RestaurantService(sessionmaker)
    digest = hashlib.sha256()
    days_total = 0
    failures = 0
    last_error = "erro"
    campuses = list(Campus)
    for campus in campuses:
        try:
            days = await asyncio.wait_for(service.refresh(campus), min(timeout, 120))
        except Exception as error:  # noqa: BLE001 — uma origem fora do ar não derruba as outras
            failures += 1
            last_error = type(error).__name__
            continue
        digest.update(f"{campus}:".encode())
        for day in sorted(days, key=lambda item: item.date):
            digest.update(day.model_dump_json(exclude_unset=True).encode())
        days_total += len(days)
    if failures == len(campuses):
        return Outcome("failed", error=f"Site do RU indisponível ({last_error}).")
    return Outcome("success", records=days_total, fingerprint=digest.hexdigest())
