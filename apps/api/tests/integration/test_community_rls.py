import hashlib
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from api.anonymous import resource_key
from api.db.models import (
    Classroom,
    ClassroomGroup,
    ForumPost,
    Material,
    Professor,
    ProfessorReview,
    Report,
    Subject,
    Tutorial,
)

from .test_rls import as_app

A = "a" * 64
B = "b" * 64


@pytest.fixture
def records(database):
    ids = {}
    with database.begin() as session:
        session.add_all(
            [
                Subject(code="FGA0001", name="MATÉRIA UM"),
                Subject(code="FGA0002", name="MATÉRIA DOIS"),
            ]
        )
        professor = Professor(name="DOCENTE SINTÉTICO", siape=1234567)
        session.add(professor)
        session.flush()
        for label, key in [("a", A), ("b", B)]:
            post = ForumPost(
                title="Título público",
                body="Texto público",
                kind="duvida",
                author_key=resource_key(key),
            )
            tutorial = Tutorial(
                title="Guia pendente",
                summary="Resumo sintético",
                body="Texto do guia",
                category="campus",
                author_key=resource_key(key),
                status="pending",
            )
            classroom = Classroom(
                subject_code="FGA0001", semester="2026.2", number=label.upper()
            )
            review = ProfessorReview(
                professor_id=professor.id,
                rating=4,
                token_hash=hashlib.sha256(key.encode()).hexdigest(),
            )
            session.add_all([post, tutorial, classroom, review])
            session.flush()
            group = ClassroomGroup(
                classroom_id=classroom.id,
                position=0,
                platform="whatsapp",
                url="https://chat.whatsapp.com/sintetico",
            )
            material = Material(
                subject_code="FGA0001",
                semester="2026.2",
                title="Resumo público",
                kind="resumo",
                filename="resumo.png",
                mime="image/png",
                size=100,
                sha256=label * 64,
                storage_key=uuid.uuid4().hex,
                uploader_key=resource_key(key),
                professors=[],
            )
            report = Report(
                target_type="post",
                target_id=post.id,
                reason="outro",
                message="Mensagem privada da moderação",
            )
            session.add_all([group, material, report])
            session.flush()
            ids[label] = {
                "post": str(post.id),
                "tutorial": str(tutorial.id),
                "group": str(group.id),
                "material": str(material.id),
                "review": str(review.id),
                "report": str(report.id),
            }
    return ids


def test_sem_prova_leitura_publica_permanece_e_dados_de_moderacao_nao_aparecem(
    postgres, records
):
    with postgres.begin() as connection:
        as_app(connection)
        assert connection.scalar(text("SELECT count(*) FROM forum_posts")) == 2
        assert connection.scalar(text("SELECT count(*) FROM materials")) == 2
        assert connection.scalar(text("SELECT count(*) FROM professor_reviews")) == 2
        assert connection.scalar(text("SELECT count(*) FROM tutorials")) == 0
        assert connection.scalar(text("SELECT count(*) FROM reports")) == 0
        assert connection.execute(text("DELETE FROM forum_posts")).rowcount == 0


def test_delete_sem_where_so_alcanca_publicacao_certa_com_chave_e_escopo(
    postgres, records
):
    with postgres.begin() as connection:
        as_app(
            connection,
            scope="community_write",
            community_operation="forum_delete",
            author_key=resource_key(A),
            forum_post=records["a"]["post"],
        )
        assert connection.execute(text("DELETE FROM forum_posts")).rowcount == 1
        assert connection.execute(
            text("SELECT id::text FROM forum_posts")
        ).scalars().all() == [records["b"]["post"]]


def test_update_sem_where_nao_altera_post_alheio_e_trocar_dono_e_recusado(
    postgres, records
):
    with postgres.begin() as connection:
        as_app(
            connection,
            scope="community_write",
            community_operation="forum_patch",
            author_key=resource_key(A),
            forum_post=records["a"]["post"],
        )
        assert (
            connection.execute(text("UPDATE forum_posts SET title = title")).rowcount
            == 1
        )
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(
            connection,
            scope="community_write",
            community_operation="forum_patch",
            author_key=resource_key(A),
            forum_post=records["a"]["post"],
        )
        connection.execute(
            text("UPDATE forum_posts SET author_key=:key"), {"key": resource_key(B)}
        )


def test_prova_sem_escopo_de_operacao_nao_autoriza_exclusao(postgres, records):
    with postgres.begin() as connection:
        as_app(connection, scope="community_write", author_key=resource_key(A))
        assert connection.execute(text("DELETE FROM forum_posts")).rowcount == 0
        assert connection.execute(text("DELETE FROM materials")).rowcount == 0
        assert connection.execute(text("DELETE FROM professor_reviews")).rowcount == 0


def test_edicao_de_grupo_sem_where_so_alcanca_turma_autorizada(postgres, records):
    with postgres.begin() as connection:
        as_app(
            connection,
            scope="community_write",
            community_operation="groups_put",
            group_subject="FGA0001",
            group_semester="2026.2",
            group_number="A",
        )
        assert connection.execute(text("DELETE FROM classroom_groups")).rowcount == 1
        assert connection.execute(
            text("SELECT id::text FROM classroom_groups")
        ).scalars().all() == [records["b"]["group"]]


def test_material_e_avaliacao_alheios_nao_sao_alterados_sem_where(postgres, records):
    with postgres.begin() as connection:
        as_app(
            connection,
            scope="community_write",
            community_operation="materials_delete",
            author_key=resource_key(A),
            material_subject="FGA0001",
            material_id=records["a"]["material"],
        )
        assert connection.execute(text("DELETE FROM materials")).rowcount == 1
    with postgres.begin() as connection:
        as_app(
            connection,
            scope="community_write",
            community_operation="reviews_put",
            review_hash=hashlib.sha256(A.encode()).hexdigest(),
            review_id=records["a"]["review"],
        )
        assert (
            connection.execute(text("UPDATE professor_reviews SET rating = 5")).rowcount
            == 1
        )
        assert (
            connection.scalar(
                text("SELECT rating FROM professor_reviews WHERE id=:id"),
                {"id": records["b"]["review"]},
            )
            == 4
        )


def test_posse_permite_ler_so_proprio_guia_pendente_e_contexto_nao_vaza(
    postgres, records
):
    with postgres.begin() as connection:
        as_app(connection, scope="community_write", author_key=resource_key(A))
        assert connection.execute(
            text("SELECT id::text FROM tutorials")
        ).scalars().all() == [records["a"]["tutorial"]]
    with postgres.begin() as connection:
        as_app(connection)
        assert connection.scalar(text("SELECT count(*) FROM tutorials")) == 0
        assert (
            connection.scalar(text("SELECT count(*) FROM community_permission_uses"))
            == 0
        )
        assert (
            connection.scalar(text("SELECT count(*) FROM community_upload_budgets"))
            == 0
        )


def test_denuncias_ficam_limitadas_ao_alvo_na_transacao_de_envio(postgres, records):
    with postgres.begin() as connection:
        as_app(connection, scope="report_submit", report_target=records["a"]["post"])
        assert connection.execute(
            text("SELECT id::text FROM reports")
        ).scalars().all() == [records["a"]["report"]]
        assert (
            connection.execute(text("UPDATE reports SET status='accepted'")).rowcount
            == 0
        )


def test_funcao_de_contador_nao_e_uma_rpc_executavel_pela_aplicacao(postgres, records):
    with pytest.raises(DBAPIError), postgres.begin() as connection:
        as_app(connection)
        connection.execute(text("SELECT public.followw_reply_counter()"))
