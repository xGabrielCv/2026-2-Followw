"""Métricas limitadas ao processo, sem parâmetros, IPs, corpos ou identificadores acadêmicos."""

from collections import deque
from datetime import UTC, datetime
from math import ceil

_MAX_ROUTES = 256
_REQUESTS: dict[tuple[str, str], dict] = {}
_ORIGINS: dict[str, dict] = {}


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


def reset() -> None:
    _REQUESTS.clear()
    _ORIGINS.clear()
