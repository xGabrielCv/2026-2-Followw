"""Papel restrito da aplicação e Row-Level Security.

Quem cria o esquema (`db-init`, CLI do administrador) usa a conta de manutenção. A API usa o papel
`followw_app`: sem SUPERUSER, sem BYPASSRLS, sem dono das tabelas. As políticas abaixo valem mesmo
que um erro de código esqueça uma checagem. RLS não substitui consultas parametrizadas: um SQL
injetado ainda poderia chamar `set_config`, por isso o esquema também limita os comandos (log só
de inserção) e todo SQL do projeto é parametrizado.

Classificação das tabelas:
  catálogo público ........ só privilégios (leitura/escrita da aplicação, nada de DDL)
  comunidade pseudônima ... só privilégios; a autoria é checada no serviço (chave por escopo)
  chamados e mensagens .... RLS: posse da chave verificada pelo banco, notas internas ocultas
  contas e sessões admin .. RLS: só no escopo `/admin`
  log de auditoria ........ RLS e sem UPDATE/DELETE: só se acrescenta
  flags e textos .......... leitura pública; escrita só no escopo `/admin`
"""

from sqlalchemy import Connection, text

APP_ROLE = "followw_app"

_ADMIN = "current_setting('app.scope', true) = 'admin'"
_TICKET_PROOF = (
    "secret_hash = current_setting('app.ticket_hash', true)"
    " OR recovery_hash = current_setting('app.recovery_hash', true)"
)
_TICKET_EXISTS = "EXISTS (SELECT 1 FROM tickets t WHERE t.id = {table}.ticket_id)"

# (tabela, comando, USING, WITH CHECK)
_POLICIES: list[tuple[str, str, str | None, str | None]] = [
    ("admin_accounts", "ALL", _ADMIN, _ADMIN),
    ("admin_sessions", "ALL", _ADMIN, _ADMIN),
    ("admin_log", "SELECT", _ADMIN, None),
    ("admin_log", "INSERT", None, _ADMIN),
    ("system_flags", "SELECT", "true", None),
    ("system_flags", "INSERT", None, _ADMIN),
    ("system_flags", "UPDATE", _ADMIN, _ADMIN),
    ("system_flags", "DELETE", _ADMIN, None),
    ("system_texts", "SELECT", "true", None),
    ("system_texts", "INSERT", None, _ADMIN),
    ("system_texts", "UPDATE", _ADMIN, _ADMIN),
    ("system_texts", "DELETE", _ADMIN, None),
    (
        "tickets",
        "SELECT",
        f"{_ADMIN} OR {_TICKET_PROOF}",
        None,
    ),
    ("tickets", "INSERT", None, "current_setting('app.scope', true) = 'ticket_create'"),
    (
        "tickets",
        "UPDATE",
        f"{_ADMIN} OR {_TICKET_PROOF}",
        f"{_ADMIN} OR {_TICKET_PROOF}",
    ),
    ("tickets", "DELETE", _ADMIN, None),
    (
        "ticket_messages",
        "SELECT",
        f"{_TICKET_EXISTS.format(table='ticket_messages')} AND ({_ADMIN} OR sender <> 'note')",
        None,
    ),
    (
        "ticket_messages",
        "INSERT",
        None,
        f"{_TICKET_EXISTS.format(table='ticket_messages')} AND ({_ADMIN} OR sender = 'student')",
    ),
]
GUARDED = tuple(dict.fromkeys(table for table, *_ in _POLICIES))
# a aplicação só acrescenta nestas (auditoria e mensagens não se reescrevem)
APPEND_ONLY = ("admin_log", "ticket_messages")


def secure(connection: Connection, password: str | None = None) -> None:
    """Idempotente; roda dentro da transação de `create_schema`, com a conta de manutenção."""
    exists = connection.execute(
        text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": APP_ROLE}
    ).first()
    if not exists:
        connection.execute(
            text(
                f"CREATE ROLE {APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT"
            )
        )
    if password:
        literal = connection.execute(
            text("SELECT quote_literal(:p)"), {"p": password}
        ).scalar_one()
        connection.execute(text(f"ALTER ROLE {APP_ROLE} LOGIN PASSWORD {literal}"))
    connection.execute(
        text(
            "DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO "
            + APP_ROLE
            + "', current_database()); END $$"
        )
    )
    connection.execute(text(f"GRANT USAGE ON SCHEMA public TO {APP_ROLE}"))
    connection.execute(
        text(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE}"
        )
    )
    connection.execute(
        text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE}")
    )
    for table in APPEND_ONLY:
        connection.execute(text(f"REVOKE UPDATE, DELETE ON {table} FROM {APP_ROLE}"))
    connection.execute(
        text(f"REVOKE INSERT, UPDATE, DELETE ON schema_updates FROM {APP_ROLE}")
    )
    for table in GUARDED:
        connection.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY"))
        connection.execute(text(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY"))
    for table, command, using, check in _POLICIES:
        name = f"{table}_{command.lower()}"
        connection.execute(text(f"DROP POLICY IF EXISTS {name} ON {table}"))
        clauses = f"FOR {command} TO {APP_ROLE}"
        if using:
            clauses += f" USING ({using})"
        if check:
            clauses += f" WITH CHECK ({check})"
        connection.execute(text(f"CREATE POLICY {name} ON {table} {clauses}"))
