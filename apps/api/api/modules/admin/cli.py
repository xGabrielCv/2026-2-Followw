"""`uv run admin-password`: define o usuário e a senha do painel no `.env` da API.

Contas no PostgreSQL usam Argon2id; recuperação revoga sessões e exige novo cadastro MFA.
"""

import argparse
import getpass
import re
import sys
from pathlib import Path

from dotenv import dotenv_values

ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def _set(lines: list[str], key: str, value: str) -> list[str]:
    pattern = re.compile(rf"^\s*{key}\s*=")
    kept = [line for line in lines if not pattern.match(line)]
    return [*kept, f"{key}={value}"]


def write_credentials(
    username: str,
    password_hash: str,
    env: Path | None = None,
    *,
    first_setup: bool = False,
) -> None:
    env = env or ENV_FILE
    if first_setup:
        lock = env.with_suffix(".setup.lock")
        lock.touch(exist_ok=False)
        try:
            saved = dotenv_values(env)
            if saved.get("ADMIN_USERNAME") and saved.get("ADMIN_PASSWORD_HASH"):
                raise FileExistsError("Acesso já configurado")
            write_credentials(username, password_hash, env)
        finally:
            lock.unlink(missing_ok=True)
        return
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = _set(lines, "ADMIN_USERNAME", username)
    # Entre aspas simples: o hash tem `$`, que o dotenv expandiria.
    lines = _set(lines, "ADMIN_PASSWORD_HASH", f"'{password_hash}'")
    lines = [line for line in lines if not re.match(r"^\s*ADMIN_TOKEN\s*=", line)]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    from api.modules.admin.passwords import MIN_PASSWORD

    parser = argparse.ArgumentParser(
        description="Cria o Owner ou altera sua senha no PostgreSQL. Recuperação MFA exige acesso ao ambiente privado do servidor."
    )
    parser.add_argument(
        "--recover",
        metavar="PSEUDONIMO",
        help="Revoga sessões e fatores do Owner indicado; exige cadastrar TOTP novamente.",
    )
    parser.add_argument(
        "--reset-legacy",
        action="store_true",
        help="Remove somente credenciais administrativas antigas do .env, sem alterar contas do banco.",
    )
    args = parser.parse_args()
    if args.reset_legacy:
        if input("Digite REMOVER LEGADO para confirmar: ") != "REMOVER LEGADO":
            sys.exit("Operação cancelada.")
        reset_credentials()
        print(
            "Credencial legada removida. Contas e MFA do PostgreSQL foram preservados."
        )
        return
    username = args.recover or input("Pseudônimo do Owner: ").strip()
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9._-]{2,63}", username):
        sys.exit(
            "Use de 3 a 64 caracteres, começando por uma letra, sem e-mail ou matrícula."
        )
    password = getpass.getpass(f"Nova senha (mínimo {MIN_PASSWORD} caracteres): ")
    if len(password) < MIN_PASSWORD or len(password) > 256:
        sys.exit("A senha deve ter de 12 a 256 caracteres.")
    if getpass.getpass("Repita a senha: ") != password:
        sys.exit("As senhas não conferem.")
    action = "RECUPERAR" if args.recover else "CONFIGURAR"
    print(
        "As sessões existentes serão revogadas."
        + (
            " Os fatores antigos e códigos de recuperação serão invalidados."
            if args.recover
            else " O MFA existente será preservado."
        )
    )
    if input(f"Digite {action} {username} para confirmar: ") != f"{action} {username}":
        sys.exit("Operação cancelada.")
    from dotenv import load_dotenv

    load_dotenv(ENV_FILE, override=False)
    import asyncio

    from api.db.main import (
        create_schema,
    )
    from api.db.main import (
        maintenance_engine as engine,
    )
    from api.db.main import (
        maintenance_session as async_session,
    )
    from api.modules.admin.recovery import configure_owner

    async def execute():
        async with engine.begin() as connection:
            await connection.run_sync(create_schema)
        await configure_owner(
            async_session, username, password, recover=bool(args.recover)
        )
        await engine.dispose()

    try:
        asyncio.run(execute())
    except ValueError as error:
        sys.exit(str(error))
    print(
        "Owner configurado. Acesse /api/admin e entre com a nova senha. MFA continua obrigatório."
    )


def reset_credentials(env: Path | None = None) -> None:
    """Recuperação só pelo terminal do servidor, nunca por uma rota pública."""
    env = env or ENV_FILE
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [
        line
        for line in lines
        if not re.match(r"^\s*ADMIN_(USERNAME|PASSWORD_HASH)\s*=", line)
    ]
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")
    env.with_suffix(".setup.lock").unlink(missing_ok=True)
