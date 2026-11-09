"""Métricas limitadas ao processo, sem parâmetros, IPs, corpos ou identificadores acadêmicos."""

import time
from collections import deque
from datetime import UTC, datetime
from math import ceil

_MAX_ROUTES = 256
_REQUESTS: dict[tuple[str, str], dict] = {}
_ORIGINS: dict[str, dict] = {}
# Atividade agregada, sem IP, sem identificador e sem parâmetros: só quantos pedidos, quando e se falharam.
_MINUTES: dict[int, list[int]] = {}  # minuto -> [pedidos, erros 5xx]
_MODULE_ERRORS: dict[tuple[int, str], int] = {}  # (hora, módulo) -> erros 5xx
_LATENCIES: deque[float] = deque(maxlen=3000)
_INFLIGHT = 0
_STARTED = time.time()
_KEEP_MINUTES = 24 * 60


def begin_request() -> None:
    global _INFLIGHT
    _INFLIGHT += 1


def end_request() -> None:
    global _INFLIGHT
    _INFLIGHT = max(0, _INFLIGHT - 1)


def _module(route: str | None) -> str:
    parts = [p for p in (route or "").split("/") if p]
    return parts[0] if parts and not parts[0].startswith("{") else "outros"


def observe_request(method: str, route: str | None, status: int, ms: float) -> None:
    key = (
        method
        if method in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
        else "OTHER",
        route or "unmatched",
    )
    if key not in _REQUESTS:
        if len(_REQUESTS) >= _MAX_ROUTES:
            key = ("OTHER", "overflow")
        _REQUESTS.setdefault(
            key,
            {"count": 0, "errors": 0, "samples": deque(maxlen=200), "last_at": None},
        )
    minute = int(time.time() // 60)
    bucket = _MINUTES.setdefault(minute, [0, 0])
    bucket[0] += 1
    bucket[1] += int(status >= 500)
    if status >= 500:
        slot = (minute // 60, _module(route))
        _MODULE_ERRORS[slot] = _MODULE_ERRORS.get(slot, 0) + 1
    _LATENCIES.append(ms)
    if len(_MINUTES) > _KEEP_MINUTES + 5:
        for old in [m for m in _MINUTES if m < minute - _KEEP_MINUTES]:
            del _MINUTES[old]
        for old in [k for k in _MODULE_ERRORS if k[0] < minute // 60 - 24]:
            del _MODULE_ERRORS[old]
    values = _REQUESTS[key]
    values["count"] += 1
    values["errors"] += int(status >= 500)
    values["samples"].append(round(ms, 2))
    values["last_at"] = datetime.now(UTC).isoformat()


def observe_origin(name: str, fields: dict) -> None:
    if name in {"sigaa.connect.completed", "sigaa.connect.failed", "origin.failed"}:
        key = "sigaa" if name.startswith("sigaa.") else "institutional"
        _ORIGINS[key] = {
            "last_at": datetime.now(UTC).isoformat(),
            "state": "failed" if name.endswith("failed") else "connected",
            "duration_ms": fields.get("duration_ms"),
            "error_type": fields.get("error_type"),
        }


def snapshot() -> dict:
    routes = []
    for (method, route), values in _REQUESTS.items():
        samples = sorted(values["samples"])
        routes.append(
            {
                "method": method,
                "route": route,
                "requests": values["count"],
                "errors": values["errors"],
                "samples": len(samples),
                "p50_ms": samples[max(0, ceil(len(samples) * 0.5) - 1)],
                "p95_ms": samples[max(0, ceil(len(samples) * 0.95) - 1)],
                "last_at": values["last_at"],
            }
        )
    return {
        "scope": "current_process",
        "routes": sorted(routes, key=lambda row: row["requests"], reverse=True),
        "origins": dict(_ORIGINS),
    }


def _sum(minutes: int) -> tuple[int, int]:
    now = int(time.time() // 60)
    rows = [v for m, v in _MINUTES.items() if m > now - minutes]
    return sum(r[0] for r in rows), sum(r[1] for r in rows)


def activity() -> dict:
    """Pedidos, não pessoas: o mesmo aluno gera vários pedidos e não há como contá-lo sem identificá-lo."""
    hour = int(time.time() // 3600)
    per_module: dict[str, int] = {}
    for (h, module), count in _MODULE_ERRORS.items():
        if h > hour - 24:
            per_module[module] = per_module.get(module, 0) + count
    latencies = sorted(_LATENCIES)

    def pct(p: float) -> float | None:
        return latencies[max(0, ceil(len(latencies) * p) - 1)] if latencies else None

    last_minute, _ = _sum(1)
    window, _ = _sum(1)
    return {
        "scope": "current_process",
        "in_flight": _INFLIGHT,
        "uptime_seconds": int(time.time() - _STARTED),
        "requests_per_second": round(_sum(1)[0] / 60, 2) if window else 0,
        "last_minute": last_minute,
        "last_5_minutes": _sum(5)[0],
        "last_15_minutes": _sum(15)[0],
        "last_hour": _sum(60)[0],
        "last_24_hours": _sum(_KEEP_MINUTES)[0],
        "errors_24_hours": _sum(_KEEP_MINUTES)[1],
        "errors_by_module_24_hours": dict(
            sorted(per_module.items(), key=lambda i: -i[1])
        ),
        "latency_ms": {
            "p50": pct(0.5),
            "p95": pct(0.95),
            "p99": pct(0.99),
            "samples": len(latencies),
        },
    }


def reset() -> None:
    _REQUESTS.clear()
    _ORIGINS.clear()
    _MINUTES.clear()
    _MODULE_ERRORS.clear()
    _LATENCIES.clear()
