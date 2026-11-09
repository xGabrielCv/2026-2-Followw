"""Atualizações aditivas e idempotentes, dentro da transação de create_schema."""

from sqlalchemy import Connection, text

from api.crypto import decrypt, encrypt


def apply_updates(connection: Connection) -> None:
    connection.execute(
        text(
            "ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS pending_nonce_hash TEXT"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES admin_accounts(id)"
        )
    )
    connection.execute(
        text("ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS actor_role TEXT")
    )
    # Converte detalhes legados sem apagar seu conteúdo e valida cifras já existentes.
    rows = connection.execute(
        text("SELECT id, detail FROM admin_log WHERE detail IS NOT NULL FOR UPDATE")
    )
    for id_, detail in rows:
        if detail.startswith(("v1:", "v2:")):
            decrypt(detail, "admin.log.detail")
        else:
            connection.execute(
                text("UPDATE admin_log SET detail=:detail WHERE id=:id"),
                {"id": id_, "detail": encrypt(detail, "admin.log.detail")},
            )
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS schema_updates (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
    )
    connection.execute(
        text(
            "INSERT INTO schema_updates(version) VALUES ('2026-11-admin-accounts') ON CONFLICT DO NOTHING"
        )
    )
