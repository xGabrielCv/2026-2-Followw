"""`uv run admin-password`: define o usuário e a senha do painel no `.env` da API.

Grava só o hash scrypt da senha. Reiniciar a API depois da troca invalida as sessões anteriores.
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
    # Importado aqui: o hash não depende do resto das configurações da API.
    from api.modules.admin.passwords import MIN_PASSWORD, hash_password

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Remove o acesso local para cadastrá-lo novamente pela página.",
    )
    args = parser.parse_args()
    if args.reset:
        reset_credentials()
        print(
            "Acesso removido. Reinicie a API e abra /api/admin para cadastrar usuário e senha."
        )
        return
    print("Painel do administrador do Followw")
    username = input("Usuário: ").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", username):
        sys.exit("Use de 3 a 64 letras, números, ponto, hífen ou sublinhado.")
    password = getpass.getpass(f"Senha (mínimo {MIN_PASSWORD} caracteres): ")
    if len(password) < MIN_PASSWORD:
        sys.exit(f"A senha precisa de pelo menos {MIN_PASSWORD} caracteres.")
    if getpass.getpass("Repita a senha: ") != password:
        sys.exit("As senhas não conferem.")
    write_credentials(username, hash_password(password))
    print(f"Pronto: usuário e hash da senha gravados em {ENV_FILE}.")
    print("Reinicie a API para valer.")


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
