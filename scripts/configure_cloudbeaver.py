"""Monta a instalacao privada sem recriar contas, workspace ou chaves do Followw."""

import argparse
import json
import os
import re
import secrets
import shutil
from pathlib import Path

import psycopg
from dotenv import dotenv_values
from psycopg import sql
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]

TABLES = (
    "units",
    "courses",
    "curricula",
    "curriculum_components",
    "subjects",
    "professors",
    "classrooms",
    "classroom_professors",
    "professor_reviews",
    "materials",
    "classroom_groups",
    "forum_posts",
    "forum_replies",
    "tutorials",
    "shared_statistics",
    "restaurant_menus",
)
ROLE = "followw_db_manager"


def configure(java: Path, source: Path | None = None) -> None:
    install = ROOT / ".local/cloudbeaver"
    source = source or ROOT / ".local/cloudbeaver-source"
    private = install / "connection.private.json"
    env_file = ROOT / "apps/api/.env"
    if not env_file.exists():
        raise SystemExit("Configure primeiro o Followw com scripts/run.ps1.")
    env = dotenv_values(env_file)
    address = (
        os.environ.get("DATABASE_MAINTENANCE_URL")
        or env.get("DATABASE_MAINTENANCE_URL")
        or env.get("DATABASE_URL")
        or "postgresql://postgres@127.0.0.1:5432/followw"
    )
    url = make_url(address)
    if url.host not in {"localhost", "127.0.0.1"}:
        raise SystemExit("Este instalador configura somente o PostgreSQL local.")
    # O administrador do PostgreSQL so e usado na instalacao; nao vai ao CloudBeaver.
    with psycopg.connect(
        url.set(drivername="postgresql").render_as_string(hide_password=False)
    ) as db:
        exists = db.execute(
            "SELECT 1 FROM pg_roles WHERE rolname=%s", (ROLE,)
        ).fetchone()
        if exists and not private.exists():
            raise SystemExit(
                "Papel existente sem arquivo privado. Restaure o backup; senha nao sera substituida."
            )
        password = (
            json.loads(private.read_text(encoding="utf-8"))["password"]
            if private.exists()
            else secrets.token_urlsafe(40)
        )
        if not exists:
            db.execute(
                sql.SQL(
                    "CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
                ).format(sql.Identifier(ROLE), sql.Literal(password))
            )
        db.execute(
            sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                sql.Identifier(url.database), sql.Identifier(ROLE)
            )
        )
        db.execute(
            sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(ROLE))
        )
        for table in TABLES:
            if db.execute("SELECT to_regclass(%s)", (f"public.{table}",)).fetchone()[0]:
                db.execute(
                    sql.SQL("GRANT SELECT ON TABLE public.{} TO {}").format(
                        sql.Identifier(table), sql.Identifier(ROLE)
                    )
                )
                db.execute(
                    sql.SQL(
                        "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.{} FROM {}"
                    ).format(sql.Identifier(table), sql.Identifier(ROLE))
                )
                rls = db.execute(
                    "SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(%s)",
                    (f"public.{table}",),
                ).fetchone()[0]
                policy = db.execute(
                    "SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=%s AND policyname='cloudbeaver_catalog_read'",
                    (table,),
                ).fetchone()
                if rls and not policy:
                    db.execute(
                        sql.SQL(
                            "CREATE POLICY cloudbeaver_catalog_read ON public.{} FOR SELECT TO {} USING (true)"
                        ).format(sql.Identifier(table), sql.Identifier(ROLE))
                    )
        for name, value in (
            ("app.scope", "admin"),
            ("statement_timeout", "60s"),
            ("idle_in_transaction_session_timeout", "120s"),
        ):
            db.execute(
                sql.SQL("ALTER ROLE {} SET {} TO {}").format(
                    sql.Identifier(ROLE), sql.Identifier(name), sql.Literal(value)
                )
            )
        install.mkdir(parents=True, exist_ok=True)
        private.write_text(json.dumps({"password": password}), encoding="utf-8")
    product = (
        source
        / "server/product/web-server/target/products/io.cloudbeaver.product/all/all/all"
    )
    for origin, target in (
        (product, "server"),
        (source / "webapp/packages/product-default/lib", "web"),
        (source / "deploy/drivers/postgresql", "drivers/postgresql"),
        (source / "deploy/drivers/h2_v2", "drivers/h2_v2"),
    ):
        shutil.copytree(origin, install / target, dirs_exist_ok=True)
    for origin in (source / "config/core").rglob("*"):
        if origin.is_file():
            target = install / "conf" / origin.relative_to(source / "config/core")
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(origin, target)
    config = (install / "cloudbeaver.generated.conf").read_text(encoding="utf-8")
    config = config.replace(
        "server: {", 'server: {\n        serverHost: "127.0.0.1",', 1
    )
    replacements = {
        "serverPort": "8978",
        "rootURI": "/api/admin/database/",
        "anonymousAccessEnabled": "false",
        "supportsCustomConnections": "false",
        "resourceManagerEnabled": "false",
        "core.localization.language": "pt_BR",
        "plugin.sql-editor.autoSave": "false",
    }
    for name, value in replacements.items():
        config, count = re.subn(
            rf'(?m)^(\s*{re.escape(name)}:\s*)"[^"\n]*"',
            lambda match, value=value: f'{match[1]}"{value}"',
            config,
        )
        if count != 1:
            raise SystemExit(
                f"Configuracao do fornecedor mudou: {name}. Revise antes de iniciar."
            )
    config_file = install / "conf/cloudbeaver.conf"
    if not config_file.exists():
        config_file.write_text(config, encoding="utf-8")
    logging = install / "conf/logback.xml"
    logging.write_text(
        logging.read_text(encoding="utf-8")
        .replace('level="DEBUG"', 'level="WARN"')
        .replace('level="INFO"', 'level="WARN"'),
        encoding="utf-8",
    )
    connection = {
        "folders": {},
        "connections": {
            "followw-local": {
                "provider": "postgresql",
                "driver": "postgres-jdbc",
                "name": "UnB - Acadêmico (somente leitura)",
                "save-password": True,
                "shared-credentials": True,
                "read-only": True,
                "configuration": {
                    "host": "127.0.0.1",
                    "port": str(url.port or 5432),
                    "database": url.database,
                    "url": f"jdbc:postgresql://127.0.0.1:{url.port or 5432}/{url.database}?user={ROLE}",
                    "properties": {"user": ROLE},
                    "auth-model": "native",
                    "auth-properties": {"userName": ROLE, "userPassword": password},
                    "configurationType": "MANUAL",
                    "user": ROLE,
                    "password": password,
                },
            }
        },
    }
    initial = install / "workspace/GlobalConfiguration/.dbeaver/data-sources.json"
    initial.parent.mkdir(parents=True, exist_ok=True)
    if not initial.exists():
        initial.write_text(json.dumps(connection), encoding="utf-8")
    initial_config = install / "conf/initial-data-sources.conf"
    if not initial_config.exists():
        initial_config.write_text(json.dumps(connection), encoding="utf-8")
    launcher = next(
        (install / "server/plugins").glob("org.jkiss.dbeaver.launcher_*.jar")
    )
    (install / "runtime.json").write_text(
        json.dumps({"java": str(java.resolve()), "launcher": str(launcher.resolve())}),
        encoding="utf-8",
    )
    print(
        "CloudBeaver preparado. Cadastro da senha adicional pelo Owner no primeiro acesso."
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--java", type=Path, required=True)
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    configure(args.java, args.source)
