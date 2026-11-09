"""Turmas do aluno: lidas do SIGAA a cada pedido, sem nada do aluno no banco."""

from datetime import date, datetime, time
from uuid import uuid4

import pytest
from pydantic import SecretStr
from sigaa_client import (
    AttendanceEntry,
    AttendanceStatus,
    Classroom,
    ClassroomAttendance,
    ClassroomFrequency,
    ClassroomGrade,
    ClassroomMember,
    ClassroomNotFound,
    ClassroomPost,
    ClassroomProgress,
    ClassroomRole,
    Credentials,
    Grade,
    News,
    PostType,
    StatisticsShare,
    StudentSituation,
    Subject,
)
from sqlalchemy import func, inspect, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from api.academic_calendar import class_days
from api.db.enums import LessonStatus
from api.db.models import Classroom as ClassroomRow
from api.db.models import Lesson, Professor
from api.db.professors import SeenProfessor, _complete, save_professors
from api.modules.classrooms.lessons import (
    Attendance,
    ClassroomFrequencyView,
    FrequencySummary,
    FrequencyTotals,
    Period,
    Timetable,
    hours,
    max_absences,
    positioned,
)
from api.modules.classrooms.repository import ClassroomRepository

CREDENCIAIS = Credentials(registration="251000000", password=SecretStr("senha123"))

FREQUENCY = ClassroomFrequency(
    progress=ClassroomProgress(taught=30, total=90, percentage=33),
    frequency=ClassroomAttendance(
        entries=(
            AttendanceEntry(
                occurred_on=date(2026, 9, 20), status=AttendanceStatus.PRESENTE
            ),
            AttendanceEntry(
                occurred_on=date(2026, 9, 22), status=AttendanceStatus.FALTA, absences=2
            ),
            AttendanceEntry(
                occurred_on=date(2026, 9, 24), status=AttendanceStatus.NAO_REGISTRADA
            ),
        ),
        attended=28,
        registered=30,
        registered_percentage=93,
        total=90,
        total_percentage=31,
    ),
)
NOT_REGISTERED = ClassroomFrequency(progress=FREQUENCY.progress)


# Aulas da tarde pelas horas-aula.
_ENDS = {1: time(14, 55), 2: time(15, 50), 3: time(16, 55)}


def _row(
    day: date,
    status: LessonStatus | None = None,
    *,
    marked: bool = False,
    absences: int | None = None,
    hours: int = 2,
    scheduled: bool = True,
) -> tuple[Lesson, Attendance | None]:
    lesson = Lesson(
        id=uuid4(),
        occurred_on=day,
        start_time=time(14),
        end_time=_ENDS[hours],
        scheduled=scheduled,
    )
    if status is None:
        return lesson, None
    return lesson, Attendance(status=status, absences=absences, marked=marked)


def _sigaa_rows() -> list[tuple[Lesson, Attendance | None]]:
    """As aulas com chamada em FREQUENCY, de duas horas-aula."""
    return [
        _row(date(2026, 9, 20), LessonStatus.PRESENTE, absences=0),
        _row(date(2026, 9, 22), LessonStatus.FALTA, absences=2),
    ]


def _view(
    rows,
    summary: ClassroomFrequency = FREQUENCY,
    now: datetime = datetime(2026, 10, 1),
    workload: int | None = 60,
) -> ClassroomFrequencyView:
    return ClassroomFrequencyView.build(
        FrequencySummary.of(summary), rows, now=now, workload=workload
    )


def _hours(schedule: str) -> dict[int, tuple[int, ...]]:
    sessions = Timetable.parse(schedule).sessions
    return {
        day: tuple(hours(period.start, period.end) for period in day_sessions)
        for day, day_sessions in sessions.items()
    }


def test_horario_vira_aulas_por_dia_com_inicio_e_fim():
    assert Timetable.parse("35T23").sessions == {
        1: (Period(time(14), time(15, 50)),),
        3: (Period(time(14), time(15, 50)),),
    }
    # Horários consecutivos são uma aula só, mesmo entre turnos ou blocos; separados, duas.
    assert Timetable.parse("35M5 35T1").sessions[1] == (Period(time(12), time(13, 50)),)
    assert _hours("3M12 3M34") == {1: (4,)}
    assert Timetable.parse("3M12 3T45").sessions[1] == (
        Period(time(8), time(9, 50)),
        Period(time(16), time(17, 50)),
    )
    assert _hours("6M1234 6M12") == {4: (4,)}
    assert Timetable.parse(None).sessions == {}
    assert Timetable.parse("99Z9 2N6").sessions == {}


def test_horas_aula_pelo_inicio_e_fim():
    assert hours(time(8), time(9, 50)) == 2
    assert hours(time(19), time(22, 30)) == 4
    assert hours(None, None) == 1


def test_aula_fora_do_horario_fica_sem_horario():
    timetable = Timetable.parse("2M12 4M123 6M123")
    assert timetable.period(date(2026, 8, 10), 0) == Period(time(8), time(9, 50))
    assert timetable.period(date(2026, 8, 10), 1) is None
    assert timetable.period(date(2026, 8, 15), 0) is None
    assert Timetable.parse(None).period(date(2026, 8, 10), 0) is None


def test_banco_aceita_uma_so_aula_sem_horario_por_dia():
    ddl = str(CreateTable(Lesson.__table__).compile(dialect=postgresql.dialect()))
    assert "NULLS NOT DISTINCT (classroom_id, occurred_on, start_time)" in ddl


def test_plano_cobre_o_semestre_pelo_horario_sem_feriados():
    plan = Timetable.parse("35M5 35T1").plan(class_days("2026.2"))
    assert plan[0] == (date(2026, 8, 11), Period(time(12), time(13, 50)))
    assert date(2026, 9, 22) not in {day for day, _ in plan}
    assert {day.weekday() for day, _ in plan} == {1, 3}
    assert plan[-1][0] == date(2026, 12, 10)
    assert Timetable.parse("3M12 3T45").plan([date(2026, 8, 11)]) == [
        (date(2026, 8, 11), Period(time(8), time(9, 50))),
        (date(2026, 8, 11), Period(time(16), time(17, 50))),
    ]
    assert Timetable.parse(None).plan(class_days("2026.2")) == []


def test_entradas_do_mesmo_dia_ganham_posicoes_em_ordem():
    entries = [
        AttendanceEntry(occurred_on=date(2026, 9, 15), status=AttendanceStatus.FALTA),
        AttendanceEntry(
            occurred_on=date(2026, 9, 15), status=AttendanceStatus.PRESENTE
        ),
        AttendanceEntry(occurred_on=date(2026, 9, 17), status=AttendanceStatus.FALTA),
    ]
    assert [slot for slot, _ in positioned(entries)] == [
        (date(2026, 9, 15), 0),
        (date(2026, 9, 15), 1),
        (date(2026, 9, 17), 0),
    ]


def test_mostra_previstas_ja_comecadas_e_sempre_as_publicadas_ou_com_situacao():
    rows = [
        _row(date(2026, 9, 21)),
        _row(date(2026, 9, 22)),
        _row(date(2026, 9, 24), scheduled=False),
        _row(date(2026, 9, 23), LessonStatus.CANCELADA, marked=True),
    ]
    view = _view(rows, NOT_REGISTERED, now=datetime(2026, 9, 22, 13, 59))
    assert [(lesson.occurred_on, lesson.status) for lesson in view.lessons] == [
        (date(2026, 9, 24), LessonStatus.NAO_REGISTRADA),
        (date(2026, 9, 23), LessonStatus.CANCELADA),
        (date(2026, 9, 21), LessonStatus.NAO_REGISTRADA),
    ]


def test_aula_de_hoje_aparece_assim_que_comeca():
    rows = [_row(date(2026, 9, 21)), _row(date(2026, 9, 22))]
    view = _view(rows, NOT_REGISTERED, now=datetime(2026, 9, 22, 14))
    assert [lesson.occurred_on for lesson in view.lessons] == [
        date(2026, 9, 22),
        date(2026, 9, 21),
    ]


def test_falta_marcada_conta_a_aula_toda_e_a_do_sigaa_suas_horas():
    rows = [
        *_sigaa_rows(),
        _row(date(2026, 9, 24)),
        _row(date(2026, 9, 25), LessonStatus.FALTA, marked=True, hours=3),
    ]
    assert [
        (lesson.occurred_on, lesson.status, lesson.absences, lesson.marked)
        for lesson in _view(rows).lessons
    ] == [
        (date(2026, 9, 25), LessonStatus.FALTA, 3, True),
        (date(2026, 9, 24), LessonStatus.NAO_REGISTRADA, 0, False),
        (date(2026, 9, 22), LessonStatus.FALTA, 2, False),
        (date(2026, 9, 20), LessonStatus.PRESENTE, 0, False),
    ]


def test_totais_contam_aulas_com_marcacoes():
    marks = [
        _row(date(2026, 9, 24), LessonStatus.FALTA, marked=True),
        _row(date(2026, 9, 25), LessonStatus.PRESENTE, marked=True),
        _row(date(2026, 9, 28), LessonStatus.CANCELADA, marked=True),
        _row(date(2026, 9, 29)),
    ]
    # 12 horas-aula, 4 de falta: 8 / 12.
    assert _view([*_sigaa_rows(), *marks]).totals == FrequencyTotals(
        presences=4, absences=4, percentage=66.7, max_absences=15, estimated=True
    )


@pytest.mark.parametrize(
    "workload,expected", [(60, 15), (90, 22), (30, 7), (None, None)]
)
def test_maximo_de_faltas_e_um_quarto_da_carga_horaria(workload, expected):
    assert max_absences(workload) == expected


def test_totais_contam_horas_aula_de_cada_dia():
    rows = [
        _row(date(2026, 9, d), LessonStatus.PRESENTE, absences=0) for d in range(1, 20)
    ]
    rows.append(_row(date(2026, 9, 21), LessonStatus.FALTA, absences=2))
    rows.append(_row(date(2026, 9, 22), LessonStatus.FALTA, absences=2))
    assert _view(rows).totals == FrequencyTotals(
        presences=38, absences=4, percentage=90.5, max_absences=15, estimated=False
    )


def test_turma_sem_carga_horaria_nao_tem_maximo_de_faltas():
    assert _view(_sigaa_rows(), workload=None).totals.max_absences is None


def test_turma_sem_horario_nao_tem_maximo_de_faltas():
    rows = [_row(date(2026, 9, 20), LessonStatus.PRESENTE, scheduled=False)]
    assert _view(rows).totals.max_absences is None


def test_aula_sem_chamada_ou_cancelada_conta_como_presenca_so_na_porcentagem():
    totals = _view([*_sigaa_rows(), _row(date(2026, 9, 24))]).totals
    assert (totals.presences, totals.absences, totals.percentage) == (2, 2, 66.7)
    cancelada = _row(date(2026, 9, 24), LessonStatus.CANCELADA, marked=True)
    assert _view([*_sigaa_rows(), cancelada]).totals == totals


def test_falta_parcial_do_sigaa_conta_so_as_horas_de_falta():
    rows = [
        _row(date(2026, 9, 20), LessonStatus.PRESENTE, absences=0),
        _row(date(2026, 9, 22), LessonStatus.FALTA, absences=1, hours=3),
    ]
    totals = _view(rows).totals
    assert (totals.presences, totals.absences, totals.percentage) == (4, 1, 80)


def test_totais_sem_chamada_do_sigaa_vem_so_das_marcacoes():
    marks = [
        _row(date(2026, 9, 24), LessonStatus.PRESENTE, marked=True),
        _row(date(2026, 9, 25), LessonStatus.FALTA, marked=True),
    ]
    assert _view(marks, NOT_REGISTERED).totals == FrequencyTotals(
        presences=2, absences=2, percentage=50, max_absences=15, estimated=True
    )
    cancelada = _row(date(2026, 9, 24), LessonStatus.CANCELADA, marked=True)
    assert _view([cancelada], NOT_REGISTERED).totals is None


def test_previstas_futuras_ficam_em_upcoming():
    rows = [_row(date(2026, 9, 21)), _row(date(2026, 9, 24)), _row(date(2026, 9, 23))]
    view = _view(rows, NOT_REGISTERED, now=datetime(2026, 9, 22, 13, 59))
    assert [lesson.occurred_on for lesson in view.upcoming] == [
        date(2026, 9, 23),
        date(2026, 9, 24),
    ]


def test_complete_professores_rejeita_email_nao_institucional():
    professor = Professor(siape=1, name="DOCENTE")
    seen_pessoal = SeenProfessor(name="DOCENTE", email="docente@gmail.com")
    _complete(professor, seen_pessoal)
    assert professor.email is None

    seen_institucional = SeenProfessor(name="DOCENTE", email="docente@unb.br")
    _complete(professor, seen_institucional)
    assert professor.email == "docente@unb.br"

    seen_subdominio = SeenProfessor(name="DOCENTE", email="docente@mat.unb.br")
    professor_sub = Professor(siape=2, name="DOCENTE 2")
    _complete(professor_sub, seen_subdominio)
    assert professor_sub.email == "docente@mat.unb.br"


def test_complete_preserva_email_pessoal_vindo_do_catalogo_publico():
    professor = Professor(siape=1, name="DOCENTE", email="docente@gmail.com")

    _complete(professor, SeenProfessor(name="DOCENTE", email="docente@unb.br"))

    assert professor.email == "docente@gmail.com"


def test_complete_nao_troca_person_id_de_docente_fora_do_catalogo():
    professor = Professor(name="DOCENTE", person_id=10)

    _complete(professor, SeenProfessor(name="DOCENTE", person_id=20))

    assert professor.person_id == 10


# --- Pelas rotas, com o SIGAA trocado por dublês -----------------------------------------

ATUAL = Classroom(
    id="AAA111",
    sigaa_id=1614141,
    number="12",
    semester="2026.2",
    current=True,
    # Terças e quintas, de duas horas-aula.
    schedule="35T23",
    subject=Subject(code="MAT0027", name="CÁLCULO 3", hours=90),
)
PASSADA = Classroom(
    id="BBB222",
    number="01",
    semester="2025.2",
    subject=Subject(code="MAT0001", name="CÁLCULO 1", hours=90),
)


@pytest.fixture
def aluno(client, cookies, stub_sigaa):
    stub_sigaa.classrooms.list_classrooms.return_value = [ATUAL, PASSADA]
    stub_sigaa.classrooms.list_grades.return_value = [
        ClassroomGrade(subject_code="mat0001", semester="2025.2", grade=Grade.MS)
    ]
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    return client


def _tabelas(database) -> set[str]:
    with database() as session:
        return set(inspect(session.get_bind()).get_table_names())


def test_lista_vem_do_sigaa_e_o_banco_so_guarda_a_turma_publica(
    aluno, database, stub_sigaa
):
    atuais = aluno.get("/classrooms")
    assert atuais.status_code == 200
    assert [c["id"] for c in atuais.json()] == ["AAA111"]
    # Só as atuais: nem vai ao relatório de notas.
    stub_sigaa.classrooms.list_grades.assert_not_awaited()

    todas = aluno.get("/classrooms", params={"semester": "all"}).json()
    assert [(c["id"], c["grade"], c["status"]) for c in todas] == [
        ("AAA111", None, "cursando"),
        ("BBB222", "MS", "concluido"),
    ]
    assert (
        aluno.get("/classrooms", params={"semester": "2025.2"}).json()[0]["id"]
        == "BBB222"
    )

    with database() as session:
        turmas = session.scalars(
            select(ClassroomRow).order_by(ClassroomRow.semester)
        ).all()
        assert [(t.subject_code, t.front_end_id) for t in turmas] == [
            ("MAT0001", "BBB222"),
            ("MAT0027", "AAA111"),
        ]
        # a turma atual ganha as aulas previstas pelo horário
        assert session.scalar(select(func.count(Lesson.id))) > 20
    assert not _tabelas(database) & {
        "users",
        "classroom_participants",
        "lesson_attendances",
        "classroom_posts",
    }


def test_turma_desconhecida_consulta_a_lista_e_a_de_outro_aluno_e_404(
    aluno, stub_sigaa
):
    stub_sigaa.classrooms.get_classroom_statistics.return_value = ()
    assert aluno.get("/classrooms/AAA111/statistics").json() == []
    assert stub_sigaa.classrooms.list_classrooms.await_count == 1
    # Mesmo já conhecida, confere vínculo na sessão atual.
    aluno.get("/classrooms/1614141/statistics")
    assert stub_sigaa.classrooms.list_classrooms.await_count == 2

    resposta = aluno.get("/classrooms/CCC333/members")
    assert resposta.status_code == 404
    assert aluno.get("/classrooms/a b/members").status_code == 422


@pytest.mark.parametrize(
    "resource", ["members", "frequency", "posts", "statistics", "posts/news:1"]
)
@pytest.mark.parametrize("identifier", ["AAA111", "1614141"])
def test_catalogo_de_outro_aluno_nao_autoriza_dados_privados(
    aluno, stub_sigaa, resource, identifier
):
    assert aluno.get("/classrooms").status_code == 200
    stub_sigaa.classrooms.list_classrooms.return_value = [PASSADA]
    outra = Credentials(registration="252000000", password=SecretStr("sintetica123"))
    from fastapi import Response

    from api.cookies import set_refresh_cookie

    response = Response()
    set_refresh_cookie(response, outra)
    from http.cookies import SimpleCookie

    jar = SimpleCookie()
    for header in response.headers.getlist("set-cookie"):
        jar.load(header)
    aluno.cookies.clear()
    aluno.cookies.update({name: value.value for name, value in jar.items()})
    assert aluno.get(f"/classrooms/{identifier}/{resource}").status_code == 404
    stub_sigaa.classrooms.list_classroom_members.assert_not_awaited()
    stub_sigaa.classrooms.get_classroom_frequency.assert_not_awaited()
    stub_sigaa.classrooms.list_classroom_posts.assert_not_awaited()
    stub_sigaa.classrooms.get_classroom_statistics.assert_not_awaited()


def test_participantes_vem_do_sigaa_e_so_os_docentes_ficam_no_banco(
    aluno, database, stub_sigaa
):
    stub_sigaa.classrooms.list_classroom_members.return_value = [
        ClassroomMember(
            name="NOME DOCENTE",
            role=ClassroomRole.PROFESSOR,
            email="docente@unb.br",
            unit="CAMPUS UNB GAMA: FCTE",
        ),
        ClassroomMember(
            name="Colega Dois",
            role=ClassroomRole.ALUNO,
            registration="252000000",
            course="ENGENHARIA DE SOFTWARE",
            unit="FCTE",
        ),
        ClassroomMember(
            name="Colega Um", role=ClassroomRole.MONITOR, registration="253000000"
        ),
    ]
    membros = aluno.get("/classrooms/AAA111/members").json()
    assert [m["name"] for m in membros["students"]] == ["Colega Dois"]
    assert membros["students"][0]["course"]["name"] == "ENGENHARIA DE SOFTWARE"
    assert [m["name"] for m in membros["monitors"]] == ["Colega Um"]
    assert [p["name"] for p in membros["professors"]] == ["NOME DOCENTE"]
    with database() as session:
        assert session.scalar(select(Professor.name)) == "NOME DOCENTE"
        despejo = " ".join(
            str(row)
            for tabela in ("classrooms", "professors", "courses")
            for row in session.execute(
                select(ClassroomRow.__table__.metadata.tables[tabela])
            ).all()
        )
    assert "252000000" not in despejo and "Colega" not in despejo


def test_indice_da_turma_encerrada_fica_publico_e_o_da_atual_nem_e_buscado(
    aluno, database, stub_sigaa
):
    stub_sigaa.classrooms.get_classroom_statistics.return_value = (
        StatisticsShare(situation=StudentSituation.APROVADO, percentage=80),
        StatisticsShare(situation=StudentSituation.REPROVADO, percentage=20),
    )
    aluno.get("/classrooms", params={"semester": "all"})
    assert aluno.get("/classrooms/AAA111/statistics").json() == []
    stub_sigaa.classrooms.get_classroom_statistics.assert_not_awaited()
    passada = aluno.get("/classrooms/BBB222/statistics").json()
    assert [s["percentage"] for s in passada] == [80, 20]
    with database() as session:
        turma = session.scalar(
            select(ClassroomRow).where(ClassroomRow.front_end_id == "BBB222")
        )
        assert turma.statistics_synced_at is not None


def _frequencia(*entries):
    return ClassroomFrequency(
        progress=ClassroomProgress(taught=30, total=90, percentage=33),
        frequency=ClassroomAttendance(
            entries=entries,
            attended=1,
            registered=2,
            registered_percentage=50,
            total=90,
            total_percentage=2,
        ),
    )


def test_frequencia_vem_do_sigaa_e_nao_fica_no_banco(aluno, database, stub_sigaa, hoje):
    hoje(datetime(2026, 9, 25, 18))
    stub_sigaa.classrooms.get_classroom_frequency.return_value = _frequencia(
        AttendanceEntry(
            occurred_on=date(2026, 9, 22), status=AttendanceStatus.FALTA, absences=2
        ),
        AttendanceEntry(
            occurred_on=date(2026, 9, 24), status=AttendanceStatus.PRESENTE
        ),
        # reposição num sábado, fora do horário
        AttendanceEntry(
            occurred_on=date(2026, 9, 19), status=AttendanceStatus.PRESENTE
        ),
    )
    resposta = aluno.get("/classrooms/AAA111/frequency")
    assert resposta.status_code == 200
    view = resposta.json()
    por_dia = {(l["occurred_on"], l["status"]) for l in view["lessons"]}
    assert ("2026-09-22", "falta") in por_dia
    assert ("2026-09-24", "presente") in por_dia
    assert ("2026-09-19", "presente") in por_dia
    assert view["progress"] == {"taught": 30, "total": 90, "percentage": 33}
    assert view["totals"]["max_absences"] == 22
    assert all(l["marked"] is False for l in view["lessons"])
    assert view["upcoming"][0]["occurred_on"] == "2026-09-29"

    with database() as session:
        turma = session.scalar(
            select(ClassroomRow).where(ClassroomRow.front_end_id == "AAA111")
        )
        assert turma.progress_taught == 30
        fora_do_plano = session.scalars(
            select(Lesson.occurred_on).where(Lesson.scheduled.is_(False))
        ).all()
        # 19 é sábado e 22 e 24 caem na semana universitária: fora do plano
        assert sorted(fora_do_plano) == [
            date(2026, 9, 19),
            date(2026, 9, 22),
            date(2026, 9, 24),
        ]

    # o SIGAA retirou a reposição: a aula fora do plano some
    stub_sigaa.classrooms.get_classroom_frequency.return_value = _frequencia(
        AttendanceEntry(
            occurred_on=date(2026, 9, 22), status=AttendanceStatus.FALTA, absences=2
        ),
    )
    view = aluno.get("/classrooms/AAA111/frequency").json()
    assert "2026-09-19" not in {l["occurred_on"] for l in view["lessons"]}
    # a presença de antes não ficou guardada em lugar nenhum
    assert ("2026-09-24", "presente") not in {
        (l["occurred_on"], l["status"]) for l in view["lessons"]
    }
    # marcar aula no servidor não existe mais: as marcações ficam no navegador
    assert aluno.patch("/classrooms/AAA111/frequency/lessons", json=[]).status_code in (
        404,
        405,
    )


def test_frequencia_de_todas_as_atuais_em_sequencia(aluno, stub_sigaa):
    stub_sigaa.classrooms.get_classroom_frequency.return_value = _frequencia()
    resultado = aluno.get("/classrooms/frequency").json()
    assert [item["classroom"]["id"] for item in resultado] == ["AAA111"]
    stub_sigaa.classrooms.get_classroom_frequency.assert_awaited_once_with("AAA111")


def test_erro_do_sigaa_nao_vira_frequencia_vazia(aluno, stub_sigaa):
    stub_sigaa.classrooms.get_classroom_frequency.side_effect = ClassroomNotFound("x")
    assert aluno.get("/classrooms/AAA111/frequency").status_code == 404


def test_frequencia_exige_login(client, stub_sigaa):
    assert client.get("/classrooms/AAA111/frequency").status_code == 401
    assert client.get("/classrooms").status_code == 401


def _post(id_, type_, title, day, **fields):
    return ClassroomPost(id=id_, type=type_, title=title, published_on=day, **fields)


def test_postagens_vem_do_sigaa_e_a_noticia_traz_o_texto_so_no_detalhe(
    aluno, stub_sigaa
):
    stub_sigaa.classrooms.list_classroom_posts.return_value = [
        _post("news:1", PostType.NEWS, "Aviso", date(2026, 9, 1), content="resumo"),
        _post(
            "topic:" + "a" * 64,
            PostType.TOPIC,
            "Tópico",
            date(2026, 9, 3),
            content="Texto",
        ),
    ]
    stub_sigaa.classrooms.get_classroom_news.return_value = News(
        id=1, title="Aviso", published_on=date(2026, 9, 1), content="Texto completo"
    )
    lista = aluno.get("/classrooms/AAA111/posts").json()
    assert [(p["title"], p["content"]) for p in lista] == [
        ("Tópico", "Texto"),
        ("Aviso", None),
    ]
    assert all(p["classroom_sigaa_id"] == 1614141 for p in lista)
    assert [
        p["id"]
        for p in aluno.get("/classrooms/AAA111/posts", params={"type": "news"}).json()
    ] == ["news:1"]

    detalhe = aluno.get("/classrooms/AAA111/posts/news:1").json()
    assert detalhe["content"] == "Texto completo"
    stub_sigaa.classrooms.get_classroom_news.assert_awaited_once_with("AAA111", 1)
    assert (
        aluno.get(f"/classrooms/AAA111/posts/topic:{'a' * 64}").json()["title"]
        == "Tópico"
    )
    assert aluno.get(f"/classrooms/AAA111/posts/topic:{'b' * 64}").status_code == 404


def test_noticias_recentes_das_turmas_atuais(aluno, stub_sigaa):
    stub_sigaa.classrooms.list_classroom_posts.return_value = [
        _post(f"news:{n}", PostType.NEWS, f"Aviso {n}", date(2026, 9, n))
        for n in range(1, 8)
    ]
    feed = aluno.get("/posts/news").json()
    assert [item["post"]["title"] for item in feed["items"]] == [
        "Aviso 7",
        "Aviso 6",
        "Aviso 5",
        "Aviso 4",
        "Aviso 3",
    ]
    assert feed["items"][0]["classroom"]["id"] == "AAA111"


# --- Docentes da lista de participantes ---------------------------------------------------


async def _turma_publica(async_database) -> ClassroomRow:
    async with async_database() as session:
        rows = await ClassroomRepository(session).save_public([ATUAL], datetime.now())
        await session.commit()
        return rows["AAA111"]


async def _salvar_docentes(async_database, classroom_id, members):
    async with async_database() as session:
        await ClassroomRepository(session).save_professor_members(classroom_id, members)
        await session.commit()


async def _docentes(async_database, classroom_id) -> list[Professor]:
    async with async_database() as session:
        classroom = await session.get_one(ClassroomRow, classroom_id)
        return list(classroom.professors)


def _docente(name, **fields):
    return ClassroomMember(name=name, role=ClassroomRole.PROFESSOR, **fields)


async def test_docente_fora_do_catalogo_e_criado_e_atualizado_pela_turma(
    async_database,
):
    turma = await _turma_publica(async_database)
    docente = _docente(
        "NOME DOCENTE", person_id=42, photo="a.jpg", unit="CAMPUS UNB GAMA: FCTE"
    )
    await _salvar_docentes(async_database, turma.id, [docente])
    await _salvar_docentes(
        async_database, turma.id, [docente.model_copy(update={"photo": "b.jpg"})]
    )
    (achado,) = await _docentes(async_database, turma.id)
    assert (achado.siape, achado.person_id, achado.photo, achado.unit_id) == (
        None,
        42,
        "b.jpg",
        673,
    )


async def test_docente_casa_com_o_catalogo_pelo_nome_sem_acento_nem_caixa(
    async_database,
):
    async with async_database() as session:
        session.add(Professor(siape=1, name="José  Araújo", unit_id=673))
        await session.commit()
    turma = await _turma_publica(async_database)
    await _salvar_docentes(
        async_database, turma.id, [_docente("JOSE ARAUJO", email="j@unb.br")]
    )
    (achado,) = await _docentes(async_database, turma.id)
    assert (achado.siape, achado.email) == (1, "j@unb.br")


async def test_docente_nao_completa_email_pessoal_da_turma(async_database):
    async with async_database() as session:
        session.add(Professor(siape=1, name="José Araújo", unit_id=673))
        await session.commit()
    turma = await _turma_publica(async_database)
    await _salvar_docentes(
        async_database, turma.id, [_docente("JOSE ARAUJO", email="j@gmail.com")]
    )
    (achado,) = await _docentes(async_database, turma.id)
    assert achado.email is None
    async with async_database() as session:
        (institucional,) = await save_professors(
            session, [SeenProfessor(name="JOSE ARAUJO", email="j@unb.br")]
        )
        assert institucional.email == "j@unb.br"
