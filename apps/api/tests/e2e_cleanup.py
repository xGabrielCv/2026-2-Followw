"""Remove somente o banco sintético criado pela própria execução E2E."""

import os
import re

import psycopg
from psycopg import sql


def cleanup():
    name = os.environ.get("FOLLOWW_E2E_DATABASE", "")
    if os.environ.get("FOLLOWW_E2E_OWNS_DATABASE") != "1" or not re.fullmatch(
        r"followw_e2e_[a-f0-9]{12}", name
    ):
        raise SystemExit("Limpeza recusada: banco não pertence a esta execução E2E.")
    with psycopg.connect(
        os.environ.get(
            "FOLLOWW_E2E_POSTGRES", "postgresql://postgres@127.0.0.1:5432/postgres"
        ),
        autocommit=True,
    ) as db:
        row = db.execute(
            "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname=%s",
            (name,),
        ).fetchone()
        if row is None:
            return
        if row[0] != "followw:e2e:discardable":
            raise SystemExit("Limpeza recusada: marcador de banco descartável ausente.")
        db.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name))
        )
        if db.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (name,)).fetchone():
            db.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(name)))


if __name__ == "__main__":
    cleanup()
