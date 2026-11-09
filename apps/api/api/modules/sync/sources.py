"""O que cada fonte faz. Lista fechada: a administração escolhe uma delas, nunca um comando."""

import asyncio
import csv
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
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


def catalog_content_hash() -> tuple[str, int]:
    digest = hashlib.sha256()
    records = 0
    for file in catalog_files():
        with file.open(encoding="utf-8", newline="") as stream:
            rows = list(csv.DictReader(stream))
        canonical = sorted(
            json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
            for row in rows
        )
        content = "\n".join(canonical).encode("utf-8")
        digest.update(file.name.encode() + b"\0" + hashlib.sha256(content).digest())
        if file.name == "classrooms.csv":
            records = len(rows)
    return digest.hexdigest(), records


async def _kill_tree(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if _WINDOWS:
        await asyncio.to_thread(
            subprocess.run,
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=_WINDOWS_FLAGS,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    await asyncio.to_thread(process.wait)


async def run_catalog(timeout: int, resource: str = "all") -> Outcome:
    """Roda o coletor público fora do processo da API: não bloqueia pedidos nem trava o loop."""
    if not SCRIPT.exists():
        return Outcome("skipped", error="Script de atualização indisponível aqui.")
    started = datetime.now(UTC)
    arguments = {
        "all": [],
        "professors": ["--professors"],
        "offers": ["--offers-only"],
        "subjects": ["--subjects-only"],
        "curricula": ["--curricula-only"],
        "units": ["--units-only"],
    }
    if resource not in arguments:
        raise ValueError("Recurso de catálogo desconhecido.")
    # Popen também funciona no SelectorEventLoop que o uvicorn usa com reload no Windows.
    with tempfile.TemporaryFile() as output:
        creation = asyncio.create_task(
            asyncio.to_thread(
                subprocess.Popen,
                [
                    sys.executable,
                    str(SCRIPT),
                    *arguments[resource],
                ],
                cwd=ROOT,
                env={**os.environ, "PYTHONUTF8": "1"},
                stdout=output,
                stderr=subprocess.STDOUT,
                # grupo próprio: o tempo limite encerra o coletor e os filhos, não a API
                creationflags=_WINDOWS_FLAGS if _WINDOWS else 0,
                start_new_session=not _WINDOWS,
            )
        )
        try:
            process = await asyncio.shield(creation)
        except asyncio.CancelledError:
            process = await creation
            await _kill_tree(process)
            raise
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    await _kill_tree(process)
                    return Outcome(
                        "failed", error=f"Excedeu o limite de {timeout} segundos."
                    )
                if os.fstat(output.fileno()).st_size > 2 * 1024 * 1024:
                    await _kill_tree(process)
                    return Outcome(
                        "failed", error="Coletor excedeu o limite de saída técnica."
                    )
                await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            await _kill_tree(process)
            raise
        if process.returncode != 0:
            return Outcome(
                "failed", error=f"Código {process.returncode}: falha na coleta pública."
            )
    content_hash, records = await asyncio.to_thread(catalog_content_hash)
    metrics = {}
    allowed = {
        "before",
        "after",
        "inserted",
        "changed",
        "unchanged",
        "removed",
        "inactivated",
        "institutional_calls",
        "duration_ms",
        "database_bytes_before",
        "database_bytes_after",
        "index_bytes_before",
        "index_bytes_after",
    }
    try:
        if (
            MARKER.stat().st_mtime >= started.timestamp()
            and MARKER.stat().st_size <= 65536
        ):
            values = json.loads(MARKER.read_text(encoding="utf-8")).get("metrics", {})
            metrics = {
                key: value
                for key, value in values.items()
                if key in allowed and type(value) is int and 0 <= value <= 10**15
            }
    except OSError, ValueError, TypeError, AttributeError:
        pass
    return Outcome(
        "success", records=records, content_hash=content_hash, metrics=metrics
    )


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
    return Outcome("success", records=days_total, content_hash=digest.hexdigest())
