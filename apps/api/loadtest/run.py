"""Teste de carga reproduzível, em banco sintético e com a UnB simulada.

    uv run --no-sync python loadtest/run.py --workers 1 --levels 10,50,100,250,500,1000 --seconds 20

Cria `followw_load_<hex>`, sobe a API com o limite de taxa elevado (só aqui; produção mantém o
padrão), sobe a escada de usuários simultâneos, mede e apaga o banco. Cada usuário virtual espera
entre 0,5 s e 1,5 s entre ações, então N usuários geram cerca de N requisições por segundo.
Nunca toca no SIGAA: a rota autenticada (que consulta o SIGAA a cada pedido) NÃO é medida aqui.
"""

import argparse
import asyncio
import json
import os
import random
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import psutil
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
ADMIN_URL = os.environ.get(
    "LOAD_POSTGRES", "postgresql://postgres@127.0.0.1:5432/postgres"
)
PORT = int(os.environ.get("LOAD_PORT", "8021"))

# (peso, método, caminho, corpo?) — leituras públicas, comunidade, chamados e RU
READS = [
    (20, "/public/config/version"),
    (10, "/public/config"),
    (15, "/public/subjects?q=calculo&limit=20"),
    (10, "/public/professors?limit=20"),
    (10, "/public/courses"),
    (8, "/public/classrooms/units"),
    (10, "/forum"),
    (6, "/materials"),
    (6, "/tutorials"),
    (5, "/public/restaurant?campus=Darcy"),
]


def pick(reads) -> str:
    return random.choices([p for _, p in reads], [w for w, _ in reads])[0]


def database_name() -> str:
    return "followw_load_" + secrets.token_hex(6)


def create_database(name: str) -> None:
    assert re.fullmatch(r"followw_load_[0-9a-f]{12}", name)
    with psycopg.connect(ADMIN_URL, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))


def drop_database(name: str) -> None:
    assert re.fullmatch(r"followw_load_[0-9a-f]{12}", name)
    with psycopg.connect(ADMIN_URL, autocommit=True) as connection:
        connection.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                sql.Identifier(name)
            )
        )


def server_env(name: str, log: Path, args) -> dict:
    env = dict(os.environ)
    password = secrets.token_hex(24)
    env.update(
        ENVIRONMENT="testing",
        DATABASE_MAINTENANCE_URL=f"postgresql+asyncpg://postgres@127.0.0.1:5432/{name}",
        DATABASE_URL=f"postgresql+asyncpg://{name}:{password}@127.0.0.1:5432/{name}",
        APP_DB_ROLE=name,
        APP_DB_PASSWORD=password,
        SESSION_LOCK_BACKEND="postgres",
        SESSION_LOCK_POOL=str(getattr(args, "lock_pool", 5)),
        RATE_LIMIT_BACKEND="postgres",
        JWT_SECRET_KEY="chave-sintetica-exclusiva-de-carga-" + "x" * 8,
        DATA_ENCRYPTION_KEY="chave-sintetica-de-carga-do-conteudo-" + "y" * 8,
        MATERIALS_DIR=str(Path(tempfile.gettempdir()) / name),
        # só neste ambiente: todos os usuários virtuais compartilham um IP
        RATE_LIMIT_REQUESTS="100000000",
        RATE_LIMIT_LOGIN_REQUESTS="100000000",
        PUBLISH_QUOTA_MULTIPLIER="100000",
        UPSTASH_REDIS_REST_URL="",
        UPSTASH_REDIS_REST_TOKEN="",
        DEMO_DATA="false",
        JOB_QUEUE="local",
        DB_POOL_SIZE=str(args.pool),
        DB_MAX_OVERFLOW=str(args.overflow),
        LOAD_ORIGIN_LOG=str(log),
        LOAD_ORIGIN_LATENCY=str(args.origin_latency),
        ADMIN_USERNAME="",
        ADMIN_PASSWORD_HASH="",
        PYTHONUTF8="1",
        # Bloqueio de saída: qualquer consulta externa que escape da simulação falha na hora, em vez
        # de chegar ao SIGAA ou à UnB de verdade (o httpx obedece a estas variáveis).
        HTTP_PROXY="http://127.0.0.1:9",
        HTTPS_PROXY="http://127.0.0.1:9",
        ALL_PROXY="http://127.0.0.1:9",
        NO_PROXY="127.0.0.1,localhost",
    )
    return env


def prepare_schema(env: dict) -> None:
    code = """import asyncio
from api.db.main import create_schema, maintenance_engine
from loadtest.fixtures import seed
async def prepare():
    async with maintenance_engine.begin() as connection:
        await connection.run_sync(create_schema)
        await connection.run_sync(seed)
    await maintenance_engine.dispose()
asyncio.run(prepare())
"""
    subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, check=True)


def start_server(env: dict, workers: int) -> subprocess.Popen:
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "loadtest.app:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
            "--workers",
            str(workers),
            "--no-access-log",
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


async def wait_ready(timeout: float = 120, workers: int = 1) -> None:
    ready = set()
    async with httpx.AsyncClient(
        timeout=1, limits=httpx.Limits(max_keepalive_connections=0), trust_env=False
    ) as client:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                response = await client.get(f"http://127.0.0.1:{PORT}/__loadtest/ready")
                if response.status_code == 200:
                    ready.add(response.json()["worker"])
                    if len(ready) == workers:
                        return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.5)
    raise SystemExit("API de carga não respondeu a tempo.")


_KNOWN: dict[int, psutil.Process] = {}


def tree_usage(process: psutil.Process) -> tuple[float, int]:
    """Reaproveita os objetos de processo: `cpu_percent` mede a janela desde a chamada anterior."""
    cpu, rss = 0.0, 0
    for found in [process, *process.children(recursive=True)]:
        item = _KNOWN.setdefault(found.pid, found)
        try:
            cpu += item.cpu_percent(interval=None)
            rss += item.memory_info().rss
        except psutil.Error:
            pass
    return cpu, rss


def connections(name: str) -> int:
    with psycopg.connect(ADMIN_URL, autocommit=True) as connection:
        return connection.execute(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid()",
            (name,),
        ).fetchone()[0]


class Level:
    def __init__(self) -> None:
        self.times: list[float] = []
        self.status: dict[str, int] = {}

    def add(self, ms: float, key: str) -> None:
        self.times.append(ms)
        self.status[key] = self.status.get(key, 0) + 1


async def user(client, stop, level, ticket_ratio, port, reads) -> None:
    base = f"http://127.0.0.1:{port}"
    author = secrets.token_hex(32)
    mine: tuple[str, str] | None = None
    await asyncio.sleep(random.uniform(0, 1))  # entrada escalonada
    while time.monotonic() < stop:
        started = time.perf_counter()
        key = "erro"
        try:
            if random.random() < ticket_ratio:
                if mine is None:
                    r = await client.post(
                        base + "/support/tickets",
                        headers={"X-Followw-Author": author},
                        json={
                            "category": "help",
                            "title": "Chamado de carga",
                            "body": "Mensagem sintética de carga.",
                        },
                    )
                    if r.status_code == 201:
                        mine = (r.json()["id"], r.json()["key"])
                else:
                    r = await client.get(
                        base + f"/support/tickets/{mine[0]}",
                        headers={"X-Ticket-Key": mine[1]},
                    )
            else:
                r = await client.get(base + pick(reads))
            key = str(r.status_code)
        except httpx.TimeoutException:
            key = "timeout"
        except httpx.HTTPError:
            key = "conexao"
        level.add((time.perf_counter() - started) * 1000, key)
        await asyncio.sleep(random.uniform(0.5, 1.5))


async def _shard(
    users: int, seconds: float, ticket_ratio: float, port: int, reads
) -> tuple[list[float], dict]:
    level = Level()
    limits = httpx.Limits(
        max_connections=users + 10, max_keepalive_connections=users + 10
    )
    async with httpx.AsyncClient(limits=limits, timeout=httpx.Timeout(20)) as client:
        stop = time.monotonic() + seconds
        await asyncio.gather(
            *[
                user(client, stop, level, ticket_ratio, port, reads)
                for _ in range(users)
            ]
        )
    return level.times, level.status


def client_shard(users, seconds, ticket_ratio, port, reads):
    """Roda em um processo próprio: um cliente Python só não gera carga que a API não aguente."""
    return asyncio.run(_shard(users, seconds, ticket_ratio, port, reads))


def pct(values: list[float], p: float) -> float:
    return (
        round(values[min(len(values) - 1, int(len(values) * p))], 1) if values else 0.0
    )


async def run_level(
    users: int, seconds: float, proc: psutil.Process, database: str, shards: int
) -> dict:
    from concurrent.futures import ProcessPoolExecutor

    loop = asyncio.get_running_loop()
    cpu_samples, rss_samples, conn_samples = [], [], []
    tree_usage(proc)  # inicia a janela do cpu_percent
    parts = [users // shards + (1 if i < users % shards else 0) for i in range(shards)]
    started = time.monotonic()
    with ProcessPoolExecutor(max_workers=shards) as pool:
        futures = [
            loop.run_in_executor(
                pool, client_shard, part, seconds, 0.05, PORT, list(READS)
            )
            for part in parts
            if part
        ]
        while not all(f.done() for f in futures):
            await asyncio.sleep(2)
            cpu, rss = tree_usage(proc)
            cpu_samples.append(cpu)
            rss_samples.append(rss)
            conn_samples.append(await asyncio.to_thread(connections, database))
        results = [f.result() for f in futures]
    elapsed = time.monotonic() - started
    times = sorted(t for part, _ in results for t in part)
    status: dict[str, int] = {}
    for _, shard_status in results:
        for key, n in shard_status.items():
            status[key] = status.get(key, 0) + n
    ok = sum(n for k, n in status.items() if k.startswith("2"))
    return {
        "users": users,
        "requests": len(times),
        "rps": round(len(times) / elapsed, 1),
        "ok_pct": round(100 * ok / max(1, len(times)), 2),
        "p50_ms": pct(times, 0.50),
        "p95_ms": pct(times, 0.95),
        "p99_ms": pct(times, 0.99),
        "max_ms": round(times[-1], 1) if times else 0,
        "status": status,
        "cpu_percent_max": round(max(cpu_samples or [0]), 1),
        "rss_mb_max": round(max(rss_samples or [0]) / 2**20),
        "pg_connections_max": max(conn_samples or [0]),
    }


async def profile(per_route: int = 60) -> list[dict]:
    """Um cliente, em sequência: quanto cada rota custa sozinha (acha o primeiro gargalo)."""
    rows = []
    async with httpx.AsyncClient(timeout=30) as client:
        for _, path in READS:
            times = []
            for _ in range(per_route):
                started = time.perf_counter()
                r = await client.get(f"http://127.0.0.1:{PORT}{path}")
                times.append((time.perf_counter() - started) * 1000)
            times.sort()
            rows.append(
                {
                    "route": path,
                    "p50_ms": pct(times, 0.5),
                    "p95_ms": pct(times, 0.95),
                    "bytes": len(r.content),
                }
            )
    return rows


async def stampede(seconds: float, log: Path, latency: float) -> dict:
    """Muitos clientes forçando revalidação do RU ao mesmo tempo: quantas consultas chegam à UnB?"""
    before = log.stat().st_size if log.exists() else 0
    count = 0
    async with httpx.AsyncClient(
        limits=httpx.Limits(max_connections=210), timeout=30
    ) as client:
        stop = time.monotonic() + seconds

        async def hammer():
            nonlocal count
            while time.monotonic() < stop:
                r = await client.get(
                    f"http://127.0.0.1:{PORT}/public/restaurant?campus=Darcy",
                    headers={"Cache-Control": "max-age=0"},
                )
                count += r.status_code == 200

        await asyncio.gather(*[hammer() for _ in range(200)])
    origin = (log.stat().st_size if log.exists() else 0) - before
    return {
        "clients": 200,
        "responses_200": count,
        "origin_calls": origin,
        "origin_latency_s": latency,
    }


async def main_async(args) -> dict:
    name = database_name()
    log = Path(tempfile.gettempdir()) / (name + ".origin")
    log.write_bytes(b"")
    sigaa_log = Path(str(log) + ".sigaa")
    sigaa_log.write_bytes(b"")
    create_database(name)
    env = server_env(name, log, args)
    server = None
    try:
        prepare_schema(env)
        server = start_server(env, args.workers)
        await wait_ready(workers=args.workers)
        proc = psutil.Process(server.pid)
        # Verifica o bloqueio ANTES de qualquer carga: se a saída externa não estiver barrada, cancela.
        async with httpx.AsyncClient() as guard:
            check = (
                await guard.get(
                    f"http://127.0.0.1:{PORT}/__loadtest/egress_check", timeout=30
                )
            ).json()
        if check.get("blocked") is not True:
            raise SystemExit(
                "ISOLAMENTO FALHOU: a API não bloqueou a saída externa. Carga cancelada."
            )
        print("isolamento de rede verificado: saída externa bloqueada", flush=True)
        # aquecimento: faz o cache do cardápio e o pool existirem
        async with httpx.AsyncClient() as warm:
            await warm.get(
                f"http://127.0.0.1:{PORT}/public/restaurant?campus=Darcy", timeout=30
            )
        async with httpx.AsyncClient() as check:
            for weight, path in list(READS):
                code = (
                    await check.get(f"http://127.0.0.1:{PORT}{path}", timeout=30)
                ).status_code
                if code != 200:
                    print(f"rota ignorada (HTTP {code}): {path}", flush=True)
                    READS.remove((weight, path))
        report = {
            "workers": args.workers,
            "client_processes": args.shards,
            "pool": f"{args.pool}+{args.overflow}",
            "machine": {
                "cpus": psutil.cpu_count(),
                "ram_gb": round(psutil.virtual_memory().total / 2**30, 1),
            },
            "levels": [],
        }
        for users in args.levels:
            result = await run_level(users, args.seconds, proc, name, args.shards)
            report["levels"].append(result)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            if result["ok_pct"] < 90:
                print("taxa de sucesso abaixo de 90%: encerrando a escada", flush=True)
                break
        report["profile"] = await profile()
        for row in report["profile"]:
            print(json.dumps(row, ensure_ascii=False), flush=True)
        async with httpx.AsyncClient() as guard:
            attempts = (
                await guard.get(
                    f"http://127.0.0.1:{PORT}/__loadtest/blocked", timeout=30
                )
            ).json()["attempts"]
        report["external_attempts_blocked"] = attempts
        report["sigaa_simulated_calls"] = sigaa_log.stat().st_size
        report["ru_simulated_calls_during_ladder"] = log.stat().st_size
        print(
            json.dumps(
                {
                    k: report[k]
                    for k in (
                        "sigaa_simulated_calls",
                        "ru_simulated_calls_during_ladder",
                    )
                }
            ),
            flush=True,
        )
        report["stampede"] = await stampede(8, log, args.origin_latency)
        print(json.dumps(report["stampede"]), flush=True)
        return report
    finally:
        if server:
            parent = psutil.Process(server.pid)
            for child in parent.children(recursive=True):
                child.kill()
            parent.kill()
        await asyncio.sleep(1)
        drop_database(name)
        log.unlink(missing_ok=True)
        Path(str(log) + ".sigaa").unlink(missing_ok=True)
        Path(str(log) + ".blocked").unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--levels", default="10,50,100,250,500,1000")
    parser.add_argument("--seconds", type=float, default=20)
    parser.add_argument("--pool", type=int, default=10)
    parser.add_argument("--overflow", type=int, default=10)
    parser.add_argument("--origin-latency", type=float, default=0.4)
    parser.add_argument("--lock-pool", type=int, default=5)
    parser.add_argument("--shards", type=int, default=4, help="processos-cliente")
    parser.add_argument("--out", default="")
    args = parser.parse_args()
    args.levels = [int(x) for x in args.levels.split(",")]
    report = asyncio.run(main_async(args))
    if args.out:
        Path(args.out).write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8"
        )


if __name__ == "__main__":
    main()
