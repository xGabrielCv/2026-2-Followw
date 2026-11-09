"""Atualizações aditivas e idempotentes, dentro da transação de create_schema."""

from sqlalchemy import Connection, text

from api.crypto import decrypt, encrypt


def apply_updates(connection: Connection) -> None:
    connection.execute(
        text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS appeal_digest TEXT")
    )
    connection.execute(
        text(
            "ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb"
        )
    )
    connection.execute(
        text("ALTER TABLE admin_log ADD COLUMN IF NOT EXISTS content_proof TEXT")
    )
    connection.execute(
        text(
            "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS appeal_decision_id UUID REFERENCES admin_log(id)"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS appeal_author_proven BOOLEAN NOT NULL DEFAULT false"
        )
    )
    connection.execute(
        text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS appeal_outcome TEXT")
    )
    connection.execute(
        text(
            "ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT false"
        )
    )
    connection.execute(
        text("ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS owner TEXT")
    )
    connection.execute(
        text(
            "ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS resource TEXT NOT NULL DEFAULT 'all'"
        )
    )
    connection.execute(
        text(
            "ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS offer_active BOOLEAN NOT NULL DEFAULT true"
        )
    )
    # O resumo do conteúdo (sincronização) teve outro nome: renomeia só se o banco ainda tiver o antigo.
    connection.execute(
        text(
            "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'sync_state' AND column_name = 'fingerprint') THEN "
            "ALTER TABLE sync_state RENAME COLUMN fingerprint TO content_hash; END IF; END $$"
        )
    )
    connection.execute(
        text("ALTER TABLE professor_reviews ADD COLUMN IF NOT EXISTS semester TEXT")
    )
    connection.execute(
        text("ALTER TABLE professor_reviews ADD COLUMN IF NOT EXISTS criteria JSONB")
    )
    connection.execute(
        text(
            "ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false"
        )
    )
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
    # Autoria por credencial de publicação: colunas legadas passam a aceitar nulo e a resposta ganha o selo
    # "de quem abriu a conversa" (sem ligar publicações entre si).
    connection.execute(
        text(
            "ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS by_op BOOLEAN NOT NULL DEFAULT false"
        )
    )
    for table, column in (
        ("forum_posts", "author_key"),
        ("forum_replies", "author_key"),
        ("tutorials", "author_key"),
        ("materials", "uploader_key"),
        ("tickets", "author_key"),
    ):
        connection.execute(
            text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL")
        )
    # A chave por aparelho dos chamados não é mais usada: zera (idempotente), sem tocar em mais nada.
    connection.execute(
        text("UPDATE tickets SET author_key = NULL WHERE author_key IS NOT NULL")
    )
    # Janelas das cotas sensíveis compartilhadas entre workers. UNLOGGED: é contador efêmero. O bucket já é
    # um HMAC (o IP nunca é gravado) e as linhas vencidas são apagadas aos poucos.
    connection.execute(
        text(
            "CREATE UNLOGGED TABLE IF NOT EXISTS rate_windows ("
            "bucket TEXT NOT NULL, window_start BIGINT NOT NULL, count INTEGER NOT NULL, "
            "PRIMARY KEY (bucket, window_start))"
        )
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
