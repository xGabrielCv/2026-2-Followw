"""Sincroniza dados públicos do Tamburetei UnB (DPO/UnB + boletins PAS Cebraspe) localmente.

Mantém tudo em `.local/data/tamburetei/` (fora do Git), descarta automaticamente se não houve
mudança real no conteúdo (SHA-256 canônico) e preserva no máximo 2 backups rotativos anteriores.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / ".local" / "data" / "tamburetei"
ALLOWED_HOSTS = frozenset({"api.tambureteiunb.com.br", "raw.githubusercontent.com"})
MAX_RESPONSE_BYTES = 15 * 1024 * 1024

TAMBURETEI_API = "https://api.tambureteiunb.com.br"
PAS_RAW_BASE = (
    "https://raw.githubusercontent.com/unb-mds/2026-02-TambureteiUnB/main"
    "/frontend/src/data"
)
PAS_FILES = (
    "pas-2023-2025.json",
    "pas-2022-2024.json",
    "pas-2021-2023.json",
    "pas-2020-2022.json",
    "pas-2019-2021.json",
    "pas-2018-2020.json",
)


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"Host não permitido para sincronização pública: {url}")


def fetch_json(client: httpx.Client, url: str) -> Any:
    """Baixa JSON de host HTTPS estritamente permitido com limite de tamanho."""
    _validate_url(url)
    with client.stream("GET", url) as response:
        _validate_url(str(response.url))
        response.raise_for_status()
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_bytes():
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                raise ValueError(
                    f"Resposta excedeu o limite seguro ({MAX_RESPONSE_BYTES} bytes)."
                )
            chunks.append(chunk)
    return json.loads(b"".join(chunks).decode("utf-8"))


def _compact_course(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "codigo_mec": raw.get("codigo_mec"),
        "nome": raw.get("nome"),
        "campus": raw.get("campus"),
        "grau": raw.get("grau"),
        "turno": raw.get("turno"),
        "slug": raw.get("slug"),
        "modalidade": raw.get("modalidade"),
        "matriz_curricular": raw.get("matriz_curricular"),
        "ano_vigencia": raw.get("ano_vigencia"),
        "total_creditos": raw.get("total_creditos"),
        "total_disciplinas": raw.get("total_disciplinas"),
        "metricas_2024": raw.get("metricas_2024"),
        "metricas_recentes": raw.get("metricas_recentes"),
        "metricas_historicas": raw.get("metricas_historicas") or [],
    }


def _compact_subject(raw: dict[str, Any]) -> dict[str, Any] | None:
    consolidada = raw.get("metrica_consolidada")
    metricas = raw.get("metricas") or []
    if not consolidada and not metricas:
        return None
    codigo = str(raw.get("codigo") or "").strip().upper()
    if not codigo:
        return None
    return {
        "codigo": codigo,
        "nome": raw.get("nome"),
        "departamento": raw.get("departamento"),
        "campus": raw.get("campus"),
        "metrica_consolidada": consolidada,
        "metricas": metricas,
    }


def canonical_hash(payload: dict[str, Any]) -> str:
    """SHA-256 determinístico do conteúdo público (ignora timestamps de coleta)."""
    encoded = json.dumps(
        payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _rotate_backups(
    snapshot_path: Path, backups_dir: Path, max_backups: int, now: datetime
) -> None:
    if not snapshot_path.exists() or max_backups <= 0:
        return
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp = now.strftime("%Y%m%dT%H%M%S%fZ")
    target = backups_dir / f"snapshot-{stamp}.json"
    shutil.copy2(snapshot_path, target)
    existing = sorted(backups_dir.glob("snapshot-*.json"), key=lambda item: item.name)
    excess = len(existing) - max_backups
    for old in existing[: max(excess, 0)]:
        old.unlink(missing_ok=True)


def _load_existing_snapshot(snapshot_path: Path) -> dict[str, Any] | None:
    if not snapshot_path.exists():
        return None
    try:
        data = json.loads(snapshot_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except OSError, ValueError:
        return None


def _is_fresh(
    meta_path: Path, snapshot_path: Path, max_age_hours: float, now: datetime
) -> bool:
    if max_age_hours <= 0 or not snapshot_path.exists() or not meta_path.exists():
        return False
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        checked = datetime.fromisoformat(str(meta.get("checked_at") or ""))
    except OSError, ValueError:
        return False
    if checked.tzinfo is None:
        checked = checked.replace(tzinfo=UTC)
    return now - checked < timedelta(hours=max_age_hours)


def collect_remote_payload(
    client: httpx.Client, existing: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Coleta cursos, disciplinas com métricas, dashboard geral e ciclos PAS."""
    raw_courses = fetch_json(client, f"{TAMBURETEI_API}/cursos")
    if not isinstance(raw_courses, list):
        raise TypeError("Formato inesperado em /cursos do Tamburetei.")
    courses = sorted(
        (_compact_course(item) for item in raw_courses if isinstance(item, dict)),
        key=lambda item: (
            str(item.get("slug") or ""),
            str(item.get("codigo_mec") or ""),
        ),
    )

    raw_subjects = fetch_json(client, f"{TAMBURETEI_API}/cadeiras")
    if not isinstance(raw_subjects, list):
        raise TypeError("Formato inesperado em /cadeiras do Tamburetei.")
    subjects_by_code: dict[str, dict[str, Any]] = {}
    for item in raw_subjects:
        if not isinstance(item, dict):
            continue
        compact = _compact_subject(item)
        if compact is not None:
            subjects_by_code[compact["codigo"]] = compact
    subjects = [subjects_by_code[code] for code in sorted(subjects_by_code)]

    raw_dashboard = fetch_json(client, f"{TAMBURETEI_API}/dashboard/geral")
    dashboard = raw_dashboard if isinstance(raw_dashboard, dict) else {}

    previous_pas = {
        str(cycle.get("ciclo")): cycle
        for cycle in ((existing or {}).get("pas_cycles") or [])
        if isinstance(cycle, dict) and cycle.get("ciclo")
    }
    pas_cycles: list[dict[str, Any]] = []
    for filename in PAS_FILES:
        cycle_label = filename.removeprefix("pas-").removesuffix(".json")
        try:
            pas_data = fetch_json(client, f"{PAS_RAW_BASE}/{filename}")
            if isinstance(pas_data, dict) and isinstance(
                pas_data.get("registros"), list
            ):
                pas_cycles.append(pas_data)
                continue
        except httpx.HTTPError, ValueError:
            if cycle_label in previous_pas:
                pas_cycles.append(previous_pas[cycle_label])
                continue
            raise

    return {
        "courses": courses,
        "subjects": subjects,
        "dashboard": dashboard,
        "pas_cycles": pas_cycles,
    }


def sync_tamburetei(
    *,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    if_stale_hours: float = 0.0,
    max_backups: int = 2,
    timeout: float = 25.0,
    client: httpx.Client | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Executa a sincronização com diff por hash e rotação de até `max_backups` arquivos."""
    current = now or datetime.now(UTC)
    snapshot_path = output_dir / "snapshot.json"
    meta_path = output_dir / "meta.json"
    backups_dir = output_dir / "backups"

    if _is_fresh(meta_path, snapshot_path, if_stale_hours, current):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return {
            "status": "skipped_fresh",
            "changed": False,
            "content_hash": meta.get("content_hash"),
            "records": int(meta.get("records") or 0),
            "courses": int(meta.get("courses") or 0),
            "subjects": int(meta.get("subjects") or 0),
            "pas_cycles": int(meta.get("pas_cycles") or 0),
        }

    existing = _load_existing_snapshot(snapshot_path)
    previous_hash: str | None = None
    if existing:
        previous_hash = str(existing.get("content_hash") or "") or canonical_hash(
            {
                "courses": existing.get("courses") or [],
                "subjects": existing.get("subjects") or [],
                "dashboard": existing.get("dashboard") or {},
                "pas_cycles": existing.get("pas_cycles") or [],
            }
        )

    owns_client = client is None
    http = client or httpx.Client(
        timeout=timeout,
        follow_redirects=False,
        headers={"User-Agent": "Followw-UnB/sync-tamburetei"},
    )
    try:
        payload = collect_remote_payload(http, existing=existing)
    finally:
        if owns_client:
            http.close()

    digest = canonical_hash(payload)
    courses_count = len(payload["courses"])
    subjects_count = len(payload["subjects"])
    pas_cycles_count = len(payload["pas_cycles"])
    pas_records_count = sum(
        len(c.get("registros") or []) for c in payload["pas_cycles"]
    )
    total_records = courses_count + subjects_count + pas_records_count

    if previous_hash == digest and snapshot_path.exists():
        meta = {
            "checked_at": current.isoformat(),
            "updated_at": existing.get("updated_at")
            if existing
            else current.isoformat(),
            "content_hash": digest,
            "records": total_records,
            "courses": courses_count,
            "subjects": subjects_count,
            "pas_cycles": pas_cycles_count,
            "changed": False,
        }
        _atomic_write_json(meta_path, meta)
        return {
            "status": "unchanged",
            "changed": False,
            "content_hash": digest,
            "records": total_records,
            "courses": courses_count,
            "subjects": subjects_count,
            "pas_cycles": pas_cycles_count,
        }

    _rotate_backups(snapshot_path, backups_dir, max(0, min(max_backups, 5)), current)
    snapshot = {
        "schema_version": 1,
        "updated_at": current.isoformat(),
        "content_hash": digest,
        "sources": {
            "api": TAMBURETEI_API,
            "pas": PAS_RAW_BASE,
        },
        **payload,
    }
    _atomic_write_json(snapshot_path, snapshot)
    meta = {
        "checked_at": current.isoformat(),
        "updated_at": current.isoformat(),
        "content_hash": digest,
        "records": total_records,
        "courses": courses_count,
        "subjects": subjects_count,
        "pas_cycles": pas_cycles_count,
        "changed": True,
    }
    _atomic_write_json(meta_path, meta)
    return {
        "status": "updated",
        "changed": True,
        "content_hash": digest,
        "records": total_records,
        "courses": courses_count,
        "subjects": subjects_count,
        "pas_cycles": pas_cycles_count,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Sincroniza dados públicos do Tamburetei UnB (DPO/UnB e PAS Cebraspe)."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Diretório local de destino (padrão: .local/data/tamburetei).",
    )
    parser.add_argument(
        "--if-stale-hours",
        type=float,
        default=0.0,
        help="Pula a rede se a última checagem local for mais recente que N horas.",
    )
    parser.add_argument(
        "--max-backups",
        type=int,
        default=2,
        help="Número máximo de backups rotativos anteriores preservados (padrão: 2).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=25.0,
        help="Tempo limite por requisição HTTP em segundos (padrão: 25).",
    )
    args = parser.parse_args(argv)
    try:
        result = sync_tamburetei(
            output_dir=args.output_dir,
            if_stale_hours=args.if_stale_hours,
            max_backups=args.max_backups,
            timeout=args.timeout,
        )
    except Exception as error:  # noqa: BLE001
        print(
            json.dumps(
                {"status": "failed", "error": f"{type(error).__name__}: {error}"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
