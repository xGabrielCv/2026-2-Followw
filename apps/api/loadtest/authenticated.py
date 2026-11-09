"""Escada autenticada sintética com cookies isolados por usuário; saída bloqueada antes da carga."""

import argparse
import asyncio
import json
import random
import secrets
import tempfile
import time
from pathlib import Path

import httpx
import psutil

from loadtest.run import (
    PORT,
    connections,
    create_database,
    database_name,
    drop_database,
    pct,
    prepare_schema,
    server_env,
    start_server,
    tree_usage,
    wait_ready,
)

READS = [
    "/me",
    "/classrooms",
    "/classrooms?semester=all",
    "/classrooms/frequency",
    "/posts",
]


class Measurements:
    def __init__(self):
        self.times = []
        self.status = {}
        self.routes = {}
        self.authenticated = 0
        self.isolation_errors = 0

    def record(self, path, milliseconds, status):
        self.times.append(milliseconds)
        self.status[status] = self.status.get(status, 0) + 1
        self.routes[path] = self.routes.get(path, 0) + 1


async def virtual_user(
    client, index, stop, measurements, bootstrap, gate, ready, limiter
):
    # Um cliente HTTP/pool por gerador, mas o cookie é SEMPRE explícito e exclusivo do usuário virtual.
    cookies = httpx.Cookies()
    registration = f"{251000000 + index:09d}"
    base = f"http://127.0.0.1:{PORT}"

    async def request(method, path, recorder=measurements, **kwargs):
        started = time.perf_counter()
        response = None
        status = "error"
        try:
            response = await client.request(
                method,
                base + path,
                headers={
                    "Cookie": "; ".join(
                        f"{key}={value}" for key, value in cookies.items()
                    )
                },
                **kwargs,
            )
            cookies.update(response.cookies)
            status = str(response.status_code)
        except httpx.TimeoutException:
            status = "timeout"
        except httpx.HTTPError:
            status = "connection"
        recorder.record(path, (time.perf_counter() - started) * 1000, status)
        return response

    valid = False
    try:
        async with limiter:
            login = await request(
                "POST",
                "/auth/sigaa",
                recorder=bootstrap,
                json={"registration": registration, "password": "simulada123"},
            )
            if login is not None and login.status_code == 200:
                identity = await request("GET", "/me", recorder=bootstrap)
                valid = (
                    identity is not None
                    and identity.status_code == 200
                    and identity.json().get("registration") == registration
                )
                if not valid:
                    measurements.isolation_errors += 1
                else:
                    measurements.authenticated += 1
    finally:
        ready.put_nowait(valid)
    if not valid:
        return
    await gate.wait()
    await asyncio.sleep(random.uniform(0, 0.5))
    while time.monotonic() < stop[0]:
        path = random.choices(READS, weights=[30, 25, 15, 15, 15])[0]
        response = await request("GET", path)
        if (
            path == "/me"
            and response is not None
            and response.status_code == 200
            and response.json().get("registration") != registration
        ):
            measurements.isolation_errors += 1
        await asyncio.sleep(random.uniform(0.5, 1.5))


async def level(users, args, process, database, offset):
    measurements = Measurements()
    bootstrap = Measurements()
    samples, memory, pools = [], [], []
    bootstrap_started = time.monotonic()
    tree_usage(process)
    limits = httpx.Limits(
        max_connections=min(users, 500), max_keepalive_connections=min(users, 500)
    )
    async with httpx.AsyncClient(limits=limits, timeout=30, trust_env=False) as client:
        stop = [0.0]
        gate = asyncio.Event()
        ready = asyncio.Queue()
        limiter = asyncio.Semaphore(50)
        work = asyncio.gather(
            *(
                virtual_user(
                    client,
                    offset + index,
                    stop,
                    measurements,
                    bootstrap,
                    gate,
                    ready,
                    limiter,
                )
                for index in range(users)
            )
        )
        started = None
        while not work.done():
            if started is None and ready.qsize() == users:
                started = time.monotonic()
                stop[0] = started + args.seconds
                gate.set()
            if started is None and time.monotonic() - bootstrap_started > 180:
                work.cancel()
                await asyncio.gather(work, return_exceptions=True)
                raise RuntimeError(
                    "Autenticação sintética excedeu 180 segundos; escada interrompida."
                )
            await asyncio.sleep(1)
            cpu, rss = tree_usage(process)
            samples.append(cpu)
            memory.append(rss)
            pools.append(await asyncio.to_thread(connections, database))
            if rss > 2 * 1024**3 or psutil.virtual_memory().available < 2 * 1024**3:
                work.cancel()
                await asyncio.gather(work, return_exceptions=True)
                raise RuntimeError(
                    "Orçamento de memória atingido; escada interrompida."
                )
        await work
    elapsed = time.monotonic() - (started or time.monotonic())
    times = sorted(measurements.times)
    ok = sum(
        value for status, value in measurements.status.items() if status.startswith("2")
    )
    return {
        "users": users,
        "bootstrap_seconds": round(
            (started or time.monotonic()) - bootstrap_started, 2
        ),
        "bootstrap_requests": len(bootstrap.times),
        "bootstrap_status": bootstrap.status,
        "bootstrap_p95_ms": pct(sorted(bootstrap.times), 0.95),
        "authenticated": measurements.authenticated,
        "requests": len(times),
        "rps": round(len(times) / elapsed, 2),
        "ok_pct": round(100 * ok / max(1, len(times)), 2),
        "p50_ms": pct(times, 0.5),
        "p95_ms": pct(times, 0.95),
        "p99_ms": pct(times, 0.99),
        "status": measurements.status,
        "routes": measurements.routes,
        "isolation_errors": measurements.isolation_errors,
        "cpu_percent_max": round(max(samples or [0]), 1),
        "rss_mb_max": round(max(memory or [0]) / 2**20, 1),
        "pg_connections_max": max(pools or [0]),
        "elapsed_seconds": round(elapsed, 2),
    }


async def run(args):
    database = database_name()
    counter = Path(tempfile.gettempdir()) / (database + ".origin")
    create_database(database)
    server = None
    report = {
        "scope": "synthetic_authenticated_local",
        "workers": args.workers,
        "pool_per_worker": f"{args.pool}+{args.overflow}; locks=5",
        "generator_processes": 1,
        "steady_seconds_per_level": args.seconds,
        "bootstrap_concurrency": 50,
        "levels": [],
        "limitations": [
            "Um gerador Python pode limitar a taxa observada.",
            "Latência institucional e catálogo são sintéticos; não é capacidade de produção.",
        ],
    }
    try:
        env = server_env(database, counter, args)
        env["FOLLOWW_SIMULATION_KEY"] = secrets.token_hex(32)
        prepare_schema(env)
        server = start_server(env, args.workers)
        await wait_ready(workers=args.workers)
        async with httpx.AsyncClient(trust_env=False) as client:
            check = (
                await client.get(f"http://127.0.0.1:{PORT}/__loadtest/egress_check")
            ).json()
            if (
                check.get("blocked") is not True
                or check.get("socket_blocked") is not True
                or check.get("async_blocked") is not True
            ):
                raise RuntimeError(
                    "Canário de rede falhou; nenhuma carga será iniciada."
                )
            report["egress_canary"] = check
            print("Canários HTTP e socket aprovados antes da carga.", flush=True)
            offset = 0
            for users in args.levels:
                result = await level(
                    users, args, psutil.Process(server.pid), database, offset
                )
                offset += users
                report["levels"].append(result)
                print(json.dumps(result), flush=True)
                if (
                    result["ok_pct"] < 90
                    or result["isolation_errors"]
                    or result["authenticated"] < users * 0.95
                ):
                    report["stopped_reason"] = (
                        "Sucesso abaixo de 90%, autenticação abaixo de 95% ou quebra de isolamento."
                    )
                    break
            report["origin_calls"] = (
                await client.get(
                    f"http://127.0.0.1:{PORT}/__loadtest/origin_calls", timeout=30
                )
            ).json()
            report["blocked_attempts"] = (
                await client.get(
                    f"http://127.0.0.1:{PORT}/__loadtest/blocked", timeout=30
                )
            ).json()
        return report
    finally:
        if server:
            parent = psutil.Process(server.pid)
            for child in parent.children(recursive=True):
                child.kill()
            parent.kill()
            server.wait(timeout=10)
        await asyncio.sleep(1)
        drop_database(database)
        for file in counter.parent.glob(counter.name + "*"):
            file.unlink(missing_ok=True)
        if args.out:
            Path(args.out).write_text(
                json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--levels", default="10,50,100,250,500,1000,2000,3000")
    parser.add_argument("--seconds", type=float, default=15)
    parser.add_argument("--pool", type=int, default=5)
    parser.add_argument("--overflow", type=int, default=5)
    parser.add_argument("--origin-latency", type=float, default=0.02)
    parser.add_argument("--out", default="")
    args = parser.parse_args()
    args.levels = [int(value) for value in args.levels.split(",")]
    if (
        args.workers not in (1, 2, 4)
        or any(value < 1 or value > 3000 for value in args.levels)
        or not 1 <= args.seconds <= 120
    ):
        raise SystemExit("Carga fora dos limites seguros do simulador local.")
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False), flush=True)
