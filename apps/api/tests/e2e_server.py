"""Servidor E2E descartável: banco novo e HTTP institucional bloqueado por mocks."""

import asyncio
import os
import re
from pathlib import Path

import httpx
import psycopg
import respx
import uvicorn
from psycopg import sql

from loadtest.egress import async_canary, canary, install
from loadtest.fixtures import seed
from loadtest.restaurant import SimulatedBrowser
from loadtest.sigaa import SimulatedSigaa


def main():
    database = os.environ.get("FOLLOWW_E2E_DATABASE", "")
    if os.environ.get("ENVIRONMENT") != "testing" or not re.fullmatch(
        r"followw_e2e_[a-f0-9]{12}", database
    ):
        raise SystemExit(
            "E2E exige ambiente testing e um nome exclusivo de banco descartável."
        )
    with psycopg.connect(
        os.environ.get(
            "FOLLOWW_E2E_POSTGRES", "postgresql://postgres@127.0.0.1:5432/postgres"
        ),
        autocommit=True,
    ) as connection:
        if connection.execute(
            "SELECT 1 FROM pg_database WHERE datname=%s", (database,)
        ).fetchone():
            raise SystemExit(
                "Banco E2E já existe; nenhum dado será apagado. Execute novamente com um nome novo."
            )
        connection.execute(
            sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database))
        )
    root = Path(__file__).resolve().parents[3]
    # A API do E2E roda com o papel restrito (RLS valendo); só o preparo usa a conta de manutenção.
    app_password = "e2e-" + os.urandom(12).hex()
    os.environ["DATABASE_MAINTENANCE_URL"] = (
        f"postgresql+asyncpg://postgres@127.0.0.1:5432/{database}"
    )
    os.environ["APP_DB_PASSWORD"] = app_password
    os.environ["APP_DB_ROLE"] = database
    os.environ["DATABASE_URL"] = (
        f"postgresql+asyncpg://{database}:{app_password}@127.0.0.1:5432/{database}"
    )
    os.environ["MATERIALS_DIR"] = str(root / ".local" / "e2e" / database / "materials")
    from api.db.main import create_schema
    from api.db.main import maintenance_engine as engine

    async def prepare():
        async with engine.begin() as connection:
            await connection.run_sync(create_schema)
            await connection.run_sync(seed)
        await engine.dispose()

    asyncio.run(prepare())
    from api.modules.public_restaurant import service as restaurant

    restaurant.UnbBrowser = SimulatedBrowser
    install()
    if not canary() or not asyncio.run(async_canary()):
        raise SystemExit("Guarda de saída não comprovada; E2E interrompido.")
    with respx.mock(assert_all_called=False) as router:
        simulated = SimulatedSigaa(latency=0.005)
        router.route(host__in=("sigaa.unb.br", "autenticacao.unb.br")).mock(
            side_effect=simulated
        )
        router.route().mock(
            return_value=httpx.Response(
                503, text="Origem institucional substituída no E2E"
            )
        )
        uvicorn.run(
            "api.main:app",
            host="127.0.0.1",
            port=int(os.environ.get("FOLLOWW_E2E_API_PORT", "8011")),
            access_log=False,
        )


if __name__ == "__main__":
    main()
