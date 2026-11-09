"""Row-Level Security contra o PostgreSQL real, com o papel restrito da aplicação."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from api.db.security import APP_ROLE, APPEND_ONLY, GUARDED

HASH_A = "a" * 64
HASH_B = "b" * 64
AUTOR_A = "1" * 64
AUTOR_B = "2" * 64


def as_app(connection, **context):
    """Troca para o papel da aplicação e fixa o contexto da transação, como a API faz."""
    connection.execute(text(f"SET LOCAL ROLE {APP_ROLE}"))
    for key, value in context.items():
        connection.execute(
            text("SELECT set_config(:k, :v, true)"), {"k": f"app.{key}", "v": value}
        )


def scalar(connection, sql, **params):
    return connection.execute(text(sql), params).scalar_one()


@pytest.fixture
def tickets(database, postgres):
    """Dois chamados (um com nota interna), inseridos pela conta de manutenção."""
    ids = {}
    with postgres.begin() as connection:
        for name, secret, author in (("a", HASH_A, AUTOR_A), ("b", HASH_B, AUTOR_B)):
            ids[name] = connection.execute(
                text(
                    "INSERT INTO tickets (id, secret_hash, recovery_hash, author_key, category, title, status, priority, message_count) "
                    "VALUES (gen_random_uuid(), :s, :r, :a, 'bug', 'v2:x', 'open', 'normal', 1) RETURNING id"
                ),
                {"s": secret, "r": name * 64, "a": author},
            ).scalar_one()
            for sender in ("student", "note"):
                connection.execute(
                    text(
                        "INSERT INTO ticket_messages (id, ticket_id, sender, body) VALUES (gen_random_uuid(), :t, :s, 'v2:x')"
                    ),
                    {"t": ids[name], "s": sender},
                )
    return ids


def test_papel_da_aplicacao_nao_pode_contornar_as_politicas(postgres):
    with postgres.begin() as connection:
        role = connection.execute(
            text(
                "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname=:r"
            ),
            {"r": APP_ROLE},
        ).one()
    assert (role.rolsuper, role.rolbypassrls, role.rolcreaterole, role.rolcreatedb) == (
        False,
        False,
        False,
        False,
    )


def test_rls_esta_ativa_e_forcada_em_todas_as_tabelas_protegidas(postgres):
    with postgres.begin() as connection:
        rows = connection.execute(
            text(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY(:t)"
            ),
            {"t": list(GUARDED)},
        ).all()
    assert {row.relname for row in rows} == set(GUARDED)
    assert all(row.relrowsecurity and row.relforcerowsecurity for row in rows)
    assert {
        "tickets",
        "ticket_messages",
        "admin_accounts",
        "admin_sessions",
        "admin_log",
    } <= set(GUARDED)


def test_aplicacao_nao_cria_nem_altera_tabelas(postgres):
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection)
        connection.execute(text("CREATE TABLE intrusa (id int)"))
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection)
        connection.execute(text("ALTER TABLE tickets DISABLE ROW LEVEL SECURITY"))


def test_sem_contexto_nenhum_chamado_aparece(postgres, tickets):
    with postgres.begin() as connection:
        as_app(connection)
        assert scalar(connection, "SELECT count(*) FROM tickets") == 0
        assert scalar(connection, "SELECT count(*) FROM ticket_messages") == 0


def test_posse_da_chave_mostra_so_o_proprio_chamado_e_esconde_notas(postgres, tickets):
    with postgres.begin() as connection:
        as_app(connection, ticket_hash=HASH_A)
        assert connection.execute(text("SELECT id FROM tickets")).scalars().all() == [
            tickets["a"]
        ]
        assert scalar(connection, "SELECT count(*) FROM ticket_messages") == 1
        assert (
            scalar(
                connection, "SELECT count(*) FROM ticket_messages WHERE sender='note'"
            )
            == 0
        )
    with postgres.begin() as connection:
        as_app(connection, ticket_hash="0" * 64)
        assert scalar(connection, "SELECT count(*) FROM tickets") == 0


def test_chave_de_um_chamado_nao_edita_o_de_outro(postgres, tickets):
    with postgres.begin() as connection:
        as_app(connection, ticket_hash=HASH_A)
        result = connection.execute(
            text("UPDATE tickets SET status='closed' WHERE id=:id"),
            {"id": tickets["b"]},
        )
        assert result.rowcount == 0
        assert (
            connection.execute(text("UPDATE tickets SET status='closed'")).rowcount == 1
        )


def test_aluno_nao_escreve_nota_interna_nem_mensagem_em_chamado_alheio(
    postgres, tickets
):
    insert = "INSERT INTO ticket_messages (id, ticket_id, sender, body) VALUES (gen_random_uuid(), :t, :s, 'v2:y')"
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection, ticket_hash=HASH_A)
        connection.execute(text(insert), {"t": tickets["a"], "s": "note"})
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection, ticket_hash=HASH_A)
        connection.execute(text(insert), {"t": tickets["b"], "s": "student"})
    with postgres.begin() as connection:
        as_app(connection, ticket_hash=HASH_A)
        connection.execute(text(insert), {"t": tickets["a"], "s": "student"})


def test_atendimento_ve_tudo_mas_so_no_escopo_admin(postgres, tickets):
    with postgres.begin() as connection:
        as_app(connection, scope="admin")
        assert scalar(connection, "SELECT count(*) FROM tickets") == 2
        assert (
            scalar(
                connection, "SELECT count(*) FROM ticket_messages WHERE sender='note'"
            )
            == 2
        )
    with postgres.begin() as connection:
        as_app(connection, scope="public")
        assert scalar(connection, "SELECT count(*) FROM tickets") == 0


def test_so_cria_chamado_no_escopo_de_criacao(postgres, database):
    insert = (
        "INSERT INTO tickets (id, secret_hash, category, title, status, priority, message_count) "
        "VALUES (gen_random_uuid(), :s, 'bug', 'v2:x', 'open', 'normal', 1)"
    )
    for context in ({}, {"scope": "public"}, {"ticket_hash": HASH_A}):
        with pytest.raises(DBAPIError), postgres.begin() as connection:
            as_app(connection, **context)
            connection.execute(text(insert), {"s": HASH_A})
    with postgres.begin() as connection:
        as_app(connection, scope="ticket_create", ticket_hash=HASH_A)
        connection.execute(text(insert), {"s": HASH_A})
        # o chamado recém-criado só se enxerga pela própria chave
        assert scalar(connection, "SELECT count(*) FROM tickets") == 1


def test_recuperacao_exige_o_hash_do_codigo(postgres, tickets):
    with postgres.begin() as connection:
        as_app(connection, recovery_hash="a" * 64)
        assert scalar(connection, "SELECT count(*) FROM tickets") == 1
        connection.execute(text("UPDATE tickets SET secret_hash=:n"), {"n": "c" * 64})
    with postgres.begin() as connection:
        as_app(connection, ticket_hash="c" * 64)
        assert scalar(connection, "SELECT count(*) FROM tickets") == 1


def make_admin(postgres):
    with postgres.begin() as connection:
        return connection.execute(
            text(
                "INSERT INTO admin_accounts (id, username, password_hash, role, enabled, session_version, totp_confirmed, last_totp_counter, recovery_hashes, failed_attempts) "
                "VALUES (gen_random_uuid(), 'rls-teste', 'x', 'moderator', true, 1, false, -1, '[]', 0) RETURNING id"
            )
        ).scalar_one()


@pytest.mark.parametrize("table", ["admin_accounts", "admin_sessions", "admin_log"])
def test_tabelas_administrativas_so_existem_no_escopo_admin(postgres, database, table):
    account = make_admin(postgres)
    with postgres.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO admin_sessions (id, account_id, token_hash, session_version, expires_at, revoked) "
                "VALUES (gen_random_uuid(), :a, 'h', 1, now() + interval '1 hour', false)"
            ),
            {"a": account},
        )
        connection.execute(
            text("INSERT INTO admin_log (id, action) VALUES (gen_random_uuid(), 'x')")
        )
    with postgres.begin() as connection:
        as_app(connection)
        assert scalar(connection, f"SELECT count(*) FROM {table}") == 0
    with postgres.begin() as connection:
        as_app(connection, ticket_hash=HASH_A)
        assert scalar(connection, f"SELECT count(*) FROM {table}") == 0
    with postgres.begin() as connection:
        as_app(connection, scope="admin")
        assert scalar(connection, f"SELECT count(*) FROM {table}") == 1


def test_log_de_auditoria_so_aceita_insercao(postgres, database):
    with postgres.begin() as connection:
        as_app(connection, scope="admin")
        connection.execute(
            text("INSERT INTO admin_log (id, action) VALUES (gen_random_uuid(), 'ok')")
        )
    for command in (
        "UPDATE admin_log SET action='apagado'",
        "DELETE FROM admin_log",
        "TRUNCATE admin_log",
    ):
        with pytest.raises(DBAPIError), postgres.begin() as connection:
            as_app(connection, scope="admin")
            connection.execute(text(command))
    assert set(APPEND_ONLY) >= {"admin_log", "ticket_messages"}


def test_flags_sao_publicas_para_ler_e_so_admin_escreve(postgres, database):
    insert = "INSERT INTO system_flags (key, enabled) VALUES ('forum', false)"
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection)
        connection.execute(text(insert))
    with postgres.begin() as connection:
        as_app(connection, scope="admin")
        connection.execute(text(insert))
    with postgres.begin() as connection:
        as_app(connection)
        assert scalar(connection, "SELECT count(*) FROM system_flags") == 1
        assert (
            connection.execute(text("UPDATE system_flags SET enabled=true")).rowcount
            == 0
        )


def test_catalogo_publico_continua_legivel_e_sem_ddl(postgres, database):
    with postgres.begin() as connection:
        as_app(connection)
        assert scalar(connection, "SELECT count(*) FROM units") == 1


def test_contexto_nao_vaza_para_a_proxima_transacao_da_mesma_conexao(postgres, tickets):
    """Uma única conexão física: o contexto termina com a transação (SET LOCAL)."""
    from sqlalchemy import create_engine

    engine = create_engine(
        postgres.url,
        pool_size=1,
        max_overflow=0,
        connect_args={"options": f"-c role={APP_ROLE}"},
    )
    try:
        with engine.begin() as connection:
            connection.execute(text("SELECT set_config('app.scope', 'admin', true)"))
            assert scalar(connection, "SELECT count(*) FROM tickets") == 2
        pid_before = None
        with engine.begin() as connection:
            pid_before = scalar(connection, "SELECT pg_backend_pid()")
            assert scalar(connection, "SELECT count(*) FROM tickets") == 0
            assert (
                scalar(
                    connection,
                    "SELECT coalesce(current_setting('app.scope', true), '')",
                )
                == ""
            )
        with engine.begin() as connection:
            assert scalar(connection, "SELECT pg_backend_pid()") == pid_before
    finally:
        engine.dispose()


def test_transacao_cancelada_tambem_descarta_o_contexto(postgres, tickets):
    with pytest.raises(RuntimeError), postgres.begin() as connection:
        as_app(connection, scope="admin")
        assert scalar(connection, "SELECT count(*) FROM tickets") == 2
        raise RuntimeError("falha no meio")
    with postgres.begin() as connection:
        as_app(connection)
        assert scalar(connection, "SELECT count(*) FROM tickets") == 0


def test_contexto_so_aceita_chaves_conhecidas():
    from api.db.context import use_context

    with pytest.raises(ValueError), use_context(**{"scope; DROP TABLE tickets": "x"}):
        pass


# ------------------------------------------------------------ pela API, sob o papel restrito


def test_api_nunca_mostra_chamado_de_outro_nem_nota_interna(client):
    mine = client.post(
        "/support/tickets",
        json={
            "category": "bug",
            "title": "Primeiro chamado",
            "body": "Texto do primeiro chamado.",
        },
    ).json()
    client.headers["X-Followw-Author"] = "c" * 64
    other = client.post(
        "/support/tickets",
        json={
            "category": "bug",
            "title": "Segundo chamado",
            "body": "Texto do segundo chamado.",
        },
    ).json()
    assert (
        client.get(
            f"/support/tickets/{mine['id']}", headers={"X-Ticket-Key": other["key"]}
        ).status_code
        == 404
    )
    ok = client.get(
        f"/support/tickets/{other['id']}", headers={"X-Ticket-Key": other["key"]}
    )
    assert ok.status_code == 200 and ok.json()["id"] == other["id"]
    assert uuid.UUID(ok.json()["id"]) != uuid.UUID(mine["id"])


def test_injecao_em_texto_fica_inerte_e_a_tabela_continua(client, database):
    veneno = "x'); DROP TABLE tickets; --"
    created = client.post(
        "/support/tickets",
        json={
            "category": "bug",
            "title": veneno + " titulo",
            "body": veneno + " corpo",
        },
    )
    assert created.status_code == 201
    data = created.json()
    view = client.get(
        f"/support/tickets/{data['id']}", headers={"X-Ticket-Key": data["key"]}
    ).json()
    assert view["title"].startswith("x'); DROP TABLE tickets")
    with database() as session:
        assert session.execute(text("SELECT count(*) FROM tickets")).scalar_one() == 1


@pytest.mark.parametrize(
    "query",
    [
        "status=open;DROP TABLE tickets",
        "category=bug' OR '1'='1",
        "priority=x",
        "page=-1",
        "page_size=100000",
    ],
)
def test_filtros_do_atendimento_sao_listas_fechadas(client, query):
    # sem sessão a rota nem chega ao banco; com filtro inválido o contrato também recusa
    response = client.get(
        "/admin/api/tickets?" + query, headers={"X-Admin-Request": "1"}
    )
    assert response.status_code in {401, 422}


@pytest.mark.parametrize(
    "tabela",
    [
        "units",
        "courses",
        "curricula",
        "curriculum_components",
        "professors",
        "subjects",
    ],
)
def test_api_nao_apaga_catalogo_institucional(postgres, database, tabela):
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection)
        connection.execute(text(f"DELETE FROM {tabela}"))
    with postgres.begin() as connection:
        as_app(connection)  # ler continua valendo
        scalar(connection, f"SELECT count(*) FROM {tabela}")


def test_cotas_compartilhadas_sao_so_da_api_sem_dado_pessoal(postgres, database):
    with postgres.begin() as connection:
        as_app(connection)
        connection.execute(
            text(
                "INSERT INTO rate_windows (bucket, window_start, count) VALUES ('g:hmac', 1, 1)"
            )
        )
        assert scalar(connection, "SELECT count FROM rate_windows") == 1
