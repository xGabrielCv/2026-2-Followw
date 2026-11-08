from uuid import uuid4

import pytest
from sigaa_client import Credentials, Grade
from sigaa_client import UserLevel as SigaaUserLevel
from sigaa_client import UserProfile as SigaaUserProfile

from api import academic_calendar
from api.db.enums import ClassroomRole, ClassroomStatus, UserLevel
from api.db.models import (
    Classroom,
    Course,
    Curriculum,
    CurriculumComponent,
    Subject,
    Unit,
)
from api.modules.classrooms.repository import ClassroomRepository
from api.modules.me.profile import enrollment
from api.modules.recommendations.ranking import (
    Component,
    chain_length,
    components_by_code,
    descendants,
    target_period,
)
from api.modules.recommendations.repository import RecommendationRepository
from api.modules.recommendations.service import HistoryItem, _rank, _until

URL = "/public/subjects"
LOGIN = Credentials(registration="251000000", password="senha")


class Scenario:
    """O aluno de teste: o perfil vai no cookie cifrado e o histórico na própria busca,
    como o navegador manda; o banco só tem o catálogo público."""

    def __init__(self, database, client, cookies):
        self.db = database
        self.client = client
        self._cookies = cookies
        self.items: list[HistoryItem] = []
        self.profile = {
            "level": SigaaUserLevel.GRADUACAO,
            "course": "ENGENHARIA DE SOFTWARE",
            "entry_semester": "2025.1",
        }
        with database.begin() as session:
            session.add(Unit(id=99, code="OTHER", name="Outra unidade"))
            course = Course(name="ENGENHARIA DE SOFTWARE", shift="DIURNO", unit_id=673)
            session.add(course)
            session.flush()
            self.course_id = course.id
        self.matrix = self.curriculum()
        self._sync_cookie()

    def sigaa_profile(self) -> SigaaUserProfile:
        return SigaaUserProfile(
            name="Aluno",
            registration="251000000",
            photo=None,
            bio=None,
            unit="FCTE",
            course=self.profile["course"],
            shift=None,
            entry_semester=self.profile["entry_semester"],
            integralization=None,
            workload=None,
            ira=None,
            mp=None,
            level=self.profile["level"],
        )

    def _sync_cookie(self):
        self.client.cookies.update(
            self._cookies(refresh=LOGIN, profile=self.sigaa_profile())
        )

    def curriculum(
        self,
        *,
        code="100/1",
        valid_from="2020.1",
        shift="D",
        active=True,
        sigaa_id=None,
    ):
        with self.db.begin() as session:
            row = Curriculum(
                course_id=self.course_id,
                sigaa_id=sigaa_id or int(uuid4()) % 10000000,
                code=code,
                valid_from=valid_from,
                created_year=2000,
                active=active,
                shift=shift,
                matrix="Fluxo",
            )
            session.add(row)
            session.flush()
            return row.id

    def subject(self, code, *, offer=True, kind="optional", period=0, **fields):
        with self.db.begin() as session:
            row = Subject(
                code=code,
                name=fields.pop("name", code),
                hours=fields.pop("hours", 60),
                unit_id=fields.pop("unit_id", 673),
                **fields,
            )
            session.add(row)
            if offer:
                session.add(
                    Classroom(subject_code=code, number="01", semester="2026.2")
                )
        if kind:
            self.component(code, kind=kind, period=period)

    def user(self, *, level=None, course_id=..., curriculum_id=...):
        """Muda o perfil: sem curso ou sem matriz é um perfil que não casa com nenhuma."""
        if level is not None:
            self.profile["level"] = SigaaUserLevel(level.value)
        if course_id is None:
            self.profile["course"] = "CURSO FORA DO CATÁLOGO"
        if curriculum_id is None:
            self.profile["entry_semester"] = None
        self._sync_cookie()

    def assign(self, entry="2025.1", course="ENGENHARIA DE SOFTWARE"):
        self.profile["entry_semester"] = entry
        self.profile["course"] = course
        self._sync_cookie()

    def component(self, code, *, kind="required", period=1, matrix=None):
        with self.db.begin() as session:
            session.add(
                CurriculumComponent(
                    curriculum_id=matrix or self.matrix,
                    subject_code=code,
                    kind=kind,
                    period=period,
                )
            )

    def history(
        self,
        code,
        *,
        grade=None,
        term="2026.1",
        enrolled=False,
        role=ClassroomRole.ALUNO,
        status=None,
    ):
        """Uma turma da lista do aluno; a turma pública entra no banco como a lista a grava."""
        with self.db.begin() as session:
            if session.get(Subject, code) is None:
                session.add(Subject(code=code, name=code))
            classroom = Classroom(subject_code=code, number=str(uuid4()), semester=term)
            session.add(classroom)
        if role != ClassroomRole.ALUNO:
            return
        self.items.append(
            HistoryItem(
                code,
                term,
                grade,
                status
                or (
                    ClassroomStatus.CURSANDO if enrolled else ClassroomStatus.CONCLUIDO
                ),
            )
        )

    def history_params(self) -> list[str]:
        return [
            ":".join(
                (
                    item.code,
                    item.semester,
                    item.grade.value if item.grade else "",
                    item.status.value if item.status else "",
                )
            )
            for item in self.items
            # O navegador só tem semestres no formato do SIGAA.
            if academic_calendar.parse_semester(item.semester)
        ]

    def get(self, **kwargs):
        params = {"history": self.history_params(), **kwargs.pop("params", {})}
        response = self.client.get(URL, params=params, **kwargs)
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        result = response.json()
        for item in result:
            assert set(item["recommendation"]) == {"reasons"}
            assert all(set(r) == {"code", "value"} for r in reasons(item))
        return result


@pytest.fixture
def scene(database, client, cookies, stub_sigaa):
    return Scenario(database, client, cookies)


@pytest.fixture
def ranked(scene, async_database):
    """O ranking interno, com score e pontos que a API não expõe."""

    async def run():
        async with async_database() as session:
            found = await enrollment(session, scene.sigaa_profile())
            curriculum = await RecommendationRepository(session).components(
                found.curriculum_id
            )
            reference = await ClassroomRepository(session).offer_semester()
            items = await _rank(
                session,
                curriculum,
                found.course.unit_id,
                reference,
                _until(scene.items, reference),
            )
            await session.rollback()
            return items

    return run


@pytest.fixture
def assign(scene):
    """O perfil do SIGAA com outro semestre de entrada ou curso: a matriz é inferida dele."""

    async def run(entry="2025.1", course="ENGENHARIA DE SOFTWARE"):
        scene.assign(entry, course)

    return run


def codes(result):
    return [i["code"] for i in result]


def reasons(item):
    return item["recommendation"]["reasons"]


def scores(items):
    return [(item.code, item.score) for item in items]


def points(items, code):
    item = next(item for item in items if item.code == code)
    return {reason.code: reason.points for reason in item.reasons}


@pytest.mark.parametrize("search", [True, False])
def test_exibicao_de_requisitos_seleciona_alternativas_completas_da_matriz(
    scene, search
):
    scene.subject("A", offer=False, kind="required")
    scene.subject("B", offer=False, kind="optional")
    scene.subject("OLD", kind=None)
    groups = [["OLD"], ["A", "B"], ["A", "OLD"]]
    scene.subject(
        "FGA0999", prerequisites=groups, corequisites=groups, equivalences=[["OTHER"]]
    )
    scene.history("OLD", grade=Grade.MM)
    # A aprovação fora da matriz continua liberando a recomendação.
    if search:
        response = scene.client.get(URL, params={"code": "FGA0999"})
        assert response.status_code == 200
        item = response.json()[0]
    else:
        item = next(item for item in scene.get() if item["code"] == "FGA0999")
    for field in ("prerequisites", "corequisites"):
        assert [[r["code"] for r in g] for g in item[field]] == groups
        selected = item[f"curriculum_{field}"]
        assert [[r["code"] for r in g] for g in selected] == [["A", "B"]]
    assert item["equivalences"][0][0]["code"] == "OTHER"
    assert item["offered_equivalences"] == []


@pytest.mark.parametrize("field", ["prerequisites", "corequisites"])
@pytest.mark.parametrize("semester", [None, "2026.1", "2026.2"])
def test_sem_requisito_da_matriz_exibe_apenas_alternativas_com_oferta_no_semestre(
    scene, field, semester
):
    scene.subject("NEW", kind=None)
    scene.subject("OLD", offer=False, kind=None)
    scene.subject("MISSING", offer=False, kind=None)
    with scene.db.begin() as session:
        session.add(Classroom(subject_code="OLD", number="01", semester="2026.1"))
        session.add(
            Classroom(
                subject_code="NEW",
                number="02",
                semester="2026.2",
                vacancies=10,
                occupied=10,
            )
        )
    groups = [["OLD"], ["NEW"], ["NEW", "MISSING"]]
    scene.subject("FGA0999", **{field: groups})
    params = {"code": "FGA0999"}
    if semester:
        params["semester"] = semester
    response = scene.client.get(URL, params=params)
    assert response.status_code == 200
    item = response.json()[0]
    expected = "OLD" if semester == "2026.1" else "NEW"
    assert [[r["code"] for r in g] for g in item[f"curriculum_{field}"]] == [[expected]]
    assert [[r["code"] for r in g] for g in item[field]] == groups


def test_recomendacoes_usam_ofertas_do_semestre_quando_requisitos_nao_estao_na_matriz(
    scene,
):
    scene.subject("OLD", kind=None)
    scene.subject("MISSING", offer=False, kind=None)
    scene.subject(
        "FGA0999", prerequisites=[["OLD"], ["MISSING"]], corequisites=[["OLD"]]
    )
    scene.history("OLD", grade=Grade.MM)
    item = next(item for item in scene.get() if item["code"] == "FGA0999")
    assert item["curriculum_prerequisites"][0][0]["code"] == "OLD"
    assert item["curriculum_corequisites"][0][0]["code"] == "OLD"


def test_requisitos_sem_alternativa_da_matriz_nem_oferta_retornam_lista_vazia(scene):
    scene.subject("A", offer=False)
    scene.subject("OLD", offer=False, kind=None)
    scene.subject("FGA0999", prerequisites=[["A", "OLD"]], corequisites=[["OLD"]])
    response = scene.client.get(URL, params={"code": "FGA0999"})
    assert response.status_code == 200
    item = response.json()[0]
    assert item["curriculum_prerequisites"] == []
    assert item["curriculum_corequisites"] == []
    assert item["prerequisites"][0][1]["code"] == "OLD"


@pytest.mark.parametrize("visitor", [True, False])
def test_sem_curriculo_identificado_os_requisitos_completos_continuam_disponiveis(
    scene, visitor
):
    scene.subject("OLD", offer=False, kind=None)
    scene.subject("FGA0999", prerequisites=[["OLD"]], corequisites=[["OLD"]])
    if visitor:
        scene.client.cookies.clear()
    else:
        scene.user(curriculum_id=None)
    response = scene.client.get(URL, params={"code": "FGA0999"})
    assert response.status_code == 200
    item = response.json()[0]
    for field in ("prerequisites", "corequisites"):
        assert item[field][0][0]["code"] == "OLD"
        assert item[f"curriculum_{field}"] is None


def test_visitante_sem_filtros_e_rejeitado(client):
    assert client.get(URL).status_code == 422


def test_filtros_mantem_a_busca_comum(scene, stub_sigaa):
    scene.subject("A")
    (item,) = scene.client.get(URL, params={"unit": "673"}).json()
    assert item["recommendation"] is None
    stub_sigaa.profile.get_profile.assert_not_awaited()


def test_busca_comum_mostra_o_tipo_na_matriz_pelo_cache(scene, stub_sigaa):
    scene.subject("REQ", kind="required", period=1)
    scene.subject("OPT", kind="optional")
    scene.subject("COMP", kind="complementary")
    scene.subject("FREE", kind=None)
    result = scene.client.get(URL, params={"unit": "673"}).json()
    assert {i["code"]: i["kind"] for i in result} == {
        "COMP": "optional",
        "FREE": "free",
        "OPT": "optional",
        "REQ": "mandatory",
    }
    stub_sigaa.profile.get_profile.assert_not_awaited()
    stub_sigaa.classrooms.list_classrooms.assert_not_awaited()
    assert {i["code"]: i["kind"] for i in scene.get()} == {
        "REQ": "mandatory",
        "COMP": "optional",
        "OPT": "optional",
    }


@pytest.mark.parametrize("period", [1, 5, 0, None])
def test_busca_e_recomendacoes_informam_apenas_semestre_positivo_do_fluxo(
    scene, period
):
    scene.subject("REQ", kind="required", period=period)
    scene.subject("FREE", kind=None)
    for params in ({"unit": "673"}, {}):
        items = {
            item["code"]: item for item in scene.client.get(URL, params=params).json()
        }
        assert items["REQ"]["curriculum_period"] == (
            period if period and period > 0 else None
        )
        if params:
            assert items["FREE"]["curriculum_period"] is None
    scene.user(curriculum_id=None)
    assert all(
        item["curriculum_period"] is None
        for item in scene.client.get(URL, params={"unit": "673"}).json()
    )
    scene.client.cookies.clear()
    assert all(
        item["curriculum_period"] is None
        for item in scene.client.get(URL, params={"unit": "673"}).json()
    )


def test_tipo_e_nulo_sem_matriz_ou_sem_login(scene):
    scene.subject("A")
    scene.user(course_id=None, curriculum_id=None)

    def kinds():
        return [i["kind"] for i in scene.client.get(URL, params={"unit": "673"}).json()]

    assert kinds() == [None]
    scene.client.cookies.clear()
    assert kinds() == [None]


def test_somente_graduacao(scene):
    scene.user(level=UserLevel.MESTRADO)
    assert scene.client.get(URL).status_code == 422


def test_historico_vem_do_navegador_e_e_validado(scene, stub_sigaa):
    scene.subject("A")
    scene.subject("B", prerequisites=[["A"]])
    assert scene.get() == [] or "B" not in codes(scene.get())
    scene.history("A", grade=Grade.SS)
    assert "B" in codes(scene.get())
    # a recomendação não vai ao SIGAA: perfil no cookie e histórico na busca
    stub_sigaa.profile.get_profile.assert_not_awaited()
    stub_sigaa.classrooms.list_classrooms.assert_not_awaited()
    stub_sigaa.classrooms.list_grades.assert_not_awaited()
    for invalido in (
        "A",
        "A:2026.1:XX:",
        "A:2026:SS:",
        "A;drop:2026.1::",
        "A:2026.1::mentindo",
    ):
        resposta = scene.client.get(URL, params={"history": [invalido]})
        assert resposta.status_code == 422, invalido


async def test_toda_a_oferta_entra_no_ranking_com_historico_vazio(scene, ranked):
    for n in range(12):
        scene.subject(f"X{n:02}", unit_id=99, kind="complementary")
    scene.component("MISSING", period=1)
    result = scene.get()
    assert codes(result) == [f"X{n:02}" for n in range(12)]
    assert scores(await ranked()) == [(f"X{n:02}", 4) for n in range(12)]
    assert scene.get() == result


def test_exclusoes_disjuntas(scene):
    scene.subject("OK")
    scene.subject("APPROVED")
    scene.history("APPROVED", grade=Grade.MM)
    scene.subject("ENROLLED")
    scene.history("ENROLLED", enrolled=True, term="2026.2")
    scene.subject("PRE", prerequisites=[["UNKNOWN"]], corequisites=[["OTHER"]])
    scene.subject("CO", prerequisites=[], corequisites=[["UNKNOWN"]])
    assert codes(scene.get()) == ["OK"]


@pytest.mark.parametrize("grade", [Grade.SS, Grade.MS, Grade.MM])
def test_mencoes_aprovadas_e_repeticao(scene, grade):
    scene.subject("A")
    scene.subject("B", prerequisites=[["A"]])
    scene.history("A", grade=grade, term="2025.2")
    scene.history("A", grade=Grade.MI, term="2026.1")
    assert codes(scene.get()) == ["B"]


def test_oferta_e_em_andamento_contam_como_concluidas(scene):
    for code in ("TARGET", "FAILED", "LOCKED", "DENIED"):
        scene.subject(code)
    scene.subject("NEEDS_TARGET", prerequisites=[["TARGET"]])
    scene.subject("NEEDS_LOCKED", prerequisites=[["LOCKED"]])
    scene.history("TARGET", grade=Grade.MM, term="2026.2", enrolled=True)
    scene.history("FAILED", grade=Grade.MI)
    scene.history("LOCKED", term="2026.2", status=ClassroomStatus.TRANCADO)
    scene.history("DENIED", term="2026.2", status=ClassroomStatus.DENIED)
    scene.history("FAILED", grade=Grade.SS, term="invalid")
    assert set(codes(scene.get())) == {
        "NEEDS_TARGET",
        "FAILED",
        "LOCKED",
        "DENIED",
    }


@pytest.mark.parametrize("closed", [False, True])
def test_encerrada_sem_mencao_libera_seguinte_mesmo_apos_consolidacao(
    scene, monkeypatch, closed
):
    monkeypatch.setattr(academic_calendar, "grades_closed", lambda semester: closed)
    scene.subject("A")
    scene.subject("B", prerequisites=[["A"]])
    scene.history("A")
    assert codes(scene.get()) == ["B"]


def test_requisitos_e_ou_com_em_andamento_e_equivalencia(scene):
    scene.history("A", grade=Grade.MM)
    scene.subject("PASS", prerequisites=[["A", "B"], ["A"]], corequisites=[["A"]])
    scene.subject("AND", prerequisites=[["A", "B"]])
    scene.subject("CURRENT", prerequisites=[["C"]])
    scene.subject("CO", corequisites=[["C"]])
    scene.subject("EQUIV", prerequisites=[["Y"]])
    scene.subject("Y", offer=False, equivalences=[["A"]])
    scene.history("C", enrolled=True, term="2026.2")
    assert codes(scene.get()) == ["CO", "CURRENT", "EQUIV", "PASS"]


@pytest.mark.parametrize("grade", [Grade.MI, Grade.II, Grade.SR])
def test_so_recomenda_repeticao_com_reprovacao_confirmada(scene, grade):
    scene.subject("FAILED")
    scene.subject("UNKNOWN")
    scene.history("FAILED", grade=grade)
    scene.history("UNKNOWN", term="2020.1")
    assert codes(scene.get()) == ["FAILED"]


def test_reprovacao_antiga_nao_libera_materia_em_curso_ou_sem_resultado(scene):
    for code in ("CURRENT", "UNKNOWN"):
        scene.subject(code)
        scene.history(code, grade=Grade.MI, term="2025.1")
    scene.history("CURRENT", enrolled=True, term="2026.2")
    scene.history("UNKNOWN", term="2026.1")
    assert scene.get() == []


def test_equivalencias_respeitam_grupos_direcao_e_nao_inferem_transitividade(scene):
    scene.history("A", grade=Grade.MM)
    scene.subject("B", equivalences=[["A"]])
    scene.subject("C", equivalences=[["A", "MISSING"]])
    scene.subject("D", equivalences=[["MISSING"], ["A"]])
    scene.subject("E", equivalences=[["B"]])
    scene.subject("F")
    scene.subject("G", offer=False, equivalences=[["F"]])
    assert codes(scene.get()) == ["C", "E", "F"]


def test_equivalencia_sem_resultado_exclui_repeticao_e_libera_requisito(
    scene, monkeypatch
):
    monkeypatch.setattr(academic_calendar, "grades_closed", lambda semester: True)
    scene.history("A", term="2020.1")
    scene.subject("B", equivalences=[["A"]])
    scene.subject("C", prerequisites=[["B"]])
    scene.subject("D", corequisites=[["B"]])
    assert codes(scene.get()) == ["C", "D"]


def test_sem_mencao_respeita_grupos_e_ou_dos_requisitos(scene, monkeypatch):
    monkeypatch.setattr(academic_calendar, "grades_closed", lambda semester: True)
    scene.history("A", term="2020.1")
    scene.subject("B", prerequisites=[["A", "MISSING"]])
    scene.subject("C", prerequisites=[["MISSING"], ["A"]])
    assert codes(scene.get()) == ["C"]


async def test_sem_mencao_conta_como_concluida_no_fluxo(scene, ranked, monkeypatch):
    monkeypatch.setattr(academic_calendar, "grades_closed", lambda semester: True)
    scene.subject("A", kind="required", period=1)
    scene.subject("B", kind="required", period=2, prerequisites=[["A"]])
    scene.history("A", term="2020.1")
    assert codes(scene.get()) == ["B"]
    assert points(await ranked(), "B")["target_period"] == 25


def test_equivalencia_de_materia_em_curso_exclui_repeticao(scene):
    scene.history("A", enrolled=True, term="2026.2")
    scene.subject("B", equivalences=[["A"]])
    scene.subject("C", prerequisites=[["B"]])
    assert codes(scene.get()) == ["C"]


def test_codigo_antigo_que_cita_o_novo_como_equivalente_vale_o_novo(scene):
    # FGA0161 cita (FGA0302), mas a FGA0302 não cita a antiga de volta
    scene.subject("OLD", kind=None, offer=False, equivalences=[["NEW"]])
    scene.history("OLD", grade=Grade.MS, term="2024.1")
    scene.subject("NEW", kind="required", period=1)
    scene.subject("NEXT", kind="required", period=2, prerequisites=[["NEW"]])
    assert codes(scene.get()) == ["NEXT"]


def test_materia_marcada_como_concluida_no_fluxo_sai_e_libera_requisito(scene):
    scene.subject("A", kind="required", period=1)
    scene.subject("B", kind="required", period=2, prerequisites=[["A"]])
    # a marcação fica no navegador e vai junto na consulta
    assert codes(scene.get(params={"completed": ["a"]})) == ["B"]


@pytest.mark.parametrize("grade", [Grade.MI, Grade.II, Grade.SR])
def test_reprovacao_em_equivalente_nao_exclui_candidata_nem_libera_requisito(
    scene, grade
):
    scene.history("A", grade=grade)
    scene.subject("B", equivalences=[["A"]])
    scene.subject("C", prerequisites=[["B"]])
    assert codes(scene.get()) == ["B"]


def test_equivalencia_fora_da_matriz_satisfaz_requisito_e_correquisito(scene):
    scene.history("A", grade=Grade.MM)
    scene.subject("X", offer=False, kind=None, equivalences=[["A"]])
    scene.subject("B", prerequisites=[["X"]])
    scene.subject("C", corequisites=[["X"]])
    assert codes(scene.get()) == ["B", "C"]


def test_correquisitos_cursaveis_no_mesmo_semestre_sao_recomendados(scene):
    scene.subject("TEO", corequisites=[["EXP"]])
    scene.subject("EXP", corequisites=[["TEO"]])
    scene.subject("BASE")
    scene.subject("JUNTO", corequisites=[["BASE"]])
    scene.subject("OU", corequisites=[["MISSING"], ["BASE"]])
    scene.subject("SEM_OFERTA", offer=False)
    scene.subject("NEEDS_OFFER", corequisites=[["SEM_OFERTA"]])
    scene.subject("LOCKED", prerequisites=[["MISSING"]])
    scene.subject("NEEDS_LOCKED", corequisites=[["LOCKED"]])
    scene.subject("CHAIN", corequisites=[["NEEDS_LOCKED"]])
    assert codes(scene.get()) == ["BASE", "EXP", "JUNTO", "OU", "TEO"]


FLOW = [
    Component(subject_code=code, kind="required", period=period)
    for code, period in (("A", 1), ("B", 1), ("C", 2), ("D", 2))
]


@pytest.mark.parametrize(
    ("done", "expected"),
    [
        (set(), 1),
        ({"A"}, 2),
        ({"A", "C"}, 2),
        ({"A", "B", "C"}, 2),
        ({"A", "B", "C", "D"}, 3),
    ],
)
def test_periodo_alvo_pela_metade_e_pela_conclusao(done, expected):
    assert target_period(components_by_code(FLOW), done, set()) == expected


def test_periodo_alvo_apos_mediana_inferior_das_matriculadas_e_duplicadas():
    flow = components_by_code(
        [
            Component(subject_code=code, kind="required", period=period)
            for code, period in (("A", 2), ("B", 4), ("C", 4), ("D", 6), (" a ", 8))
        ]
        + [Component(subject_code="A", kind="optional", period=0)]
    )
    assert flow["A"].period == 2
    assert target_period(flow, set(), {"A", "B", "C", "D"}) == 5
    optional = [Component(subject_code="X", kind="optional", period=0)]
    assert target_period(components_by_code(optional), set(), set()) is None


def test_atrasada_apos_o_periodo_em_andamento(scene):
    for code, period in (("A", 2), ("B", 4), ("C", 4), ("D", 6)):
        scene.component(code, period=period)
        scene.history(code, enrolled=True, term="2026.2")
    scene.subject("OLD", kind="required", period=1)
    scene.component("OLD", kind="optional", period=0)
    (item,) = scene.get()
    assert [r["code"] for r in reasons(item)] == [
        "required",
        "overdue",
        "same_unit",
        "hours",
    ]


async def test_selecao_de_matriz_por_turno_revisao_e_entrada(scene, assign):
    scene.subject("A", kind=None)
    scene.curriculum(code="100/2", valid_from="2024.1", sigaa_id=12)
    selected = scene.curriculum(code="100/3", valid_from="2024.1", sigaa_id=13)
    scene.curriculum(code="100/3", valid_from="2024.1", sigaa_id=11)
    scene.curriculum(code="100/99", valid_from="2024.1", shift="N")
    scene.curriculum(code="100/99", valid_from="2024.1", active=False)
    scene.curriculum(code="100/99", valid_from="2027.1")
    scene.curriculum(code="100/4", valid_from="2026.1")
    scene.user(curriculum_id=None)
    await assign()
    assert scene.get() == []
    scene.component("A", kind="optional", matrix=selected)
    assert codes(scene.get()) == ["A"]


async def test_entrada_antiga_e_turno_desconhecido_tem_alternativa(scene, assign):
    scene.subject("A", kind=None)
    scene.user(curriculum_id=None)
    with scene.db.begin() as session:
        session.get(Curriculum, scene.matrix).shift = "N"
    fallback = scene.curriculum(shift=None, valid_from="2024.1")
    scene.component("A", kind="optional", matrix=fallback)
    await assign(entry="2010.1")
    assert codes(scene.get()) == ["A"]


@pytest.mark.parametrize("mode", ["opposite_shift", "other_course", "no_entry"])
async def test_sem_matriz_recomendacoes_sao_rejeitadas(scene, assign, mode):
    scene.subject("A", kind="required", period=None)
    scene.user(curriculum_id=None)
    entry, course = "2025.1", "ENGENHARIA DE SOFTWARE"
    if mode == "opposite_shift":
        with scene.db.begin() as session:
            session.get(Curriculum, scene.matrix).shift = "N"
    elif mode == "other_course":
        course = "OUTRO CURSO"
    else:
        entry = None
    await assign(entry=entry, course=course)
    assert scene.client.get(URL).status_code == 422


def test_sem_matriz_a_busca_comum_continua_funcionando(scene, stub_sigaa):
    scene.subject("A")
    scene.user(curriculum_id=None)
    (item,) = scene.client.get(URL, params={"unit": "673"}).json()
    assert item["kind"] is None
    stub_sigaa.classrooms.list_classrooms.assert_not_awaited()


async def test_cadeias_contam_as_obrigatorias_pendentes_descendentes(scene, ranked):
    scene.subject("X", kind="required", period=1)
    scene.history("A", grade=Grade.MM)
    for code, rules, period in (
        ("Y0", [["X"]], 2),
        ("Y1", [["X"]], 2),
        ("AND", [["X", "B"]], 2),
        ("OR", [["X"], ["A"]], 2),
        ("T", [["Y0"]], 3),
        ("DEEP", [["T"]], 4),
        ("DONE", [["X"]], 2),
    ):
        scene.subject(
            code, offer=False, kind="required", period=period, prerequisites=rules
        )
    scene.history("DONE", grade=Grade.MM)
    scene.subject("FREE", offer=False, kind=None, prerequisites=[["X"]])
    scene.subject("OPT", offer=False, kind="optional", prerequisites=[["X"]])
    scene.subject(
        "AFTER_OPT", offer=False, kind="required", period=5, prerequisites=[["OPT"]]
    )
    scene.subject("O", kind="optional")
    scene.subject(
        "NEEDS_O", offer=False, kind="required", period=2, prerequisites=[["O"]]
    )
    items = {i["code"]: i for i in scene.get()}
    assert [(r["code"], r["value"]) for r in reasons(items["X"])] == [
        ("required", None),
        ("chain_length", 3),
        ("chain_width", 6),
        ("target_period", None),
        ("same_unit", None),
        ("hours", 60),
    ]
    assert [r["code"] for r in reasons(items["O"])] == ["same_unit", "hours"]
    x = points(await ranked(), "X")
    assert x["chain_length"] == 30 and x["chain_width"] == 30


def test_cadeias_toleram_pre_requisitos_ciclicos():
    graph = {"A": {"B"}, "B": {"A", "C"}}
    assert chain_length("A", graph) == 2
    assert descendants("A", graph) == {"B", "C"}


def test_turmas_vem_do_semestre_da_oferta(scene):
    scene.subject("A")
    with scene.db.begin() as session:
        session.add(Classroom(subject_code="A", number="00", semester="2026.2"))
        session.add(Classroom(subject_code="A", number="02", semester="2026.1"))
    (item,) = scene.get()
    assert [(c["number"], c["semester"]) for c in item["classrooms"]] == [
        ("00", "2026.2"),
        ("01", "2026.2"),
    ]


def test_sem_turmas_nada_e_recomendado(scene):
    scene.subject("A", offer=False)
    assert scene.get() == []


async def test_exemplos_de_score(scene, ranked):
    for code, period, unlocks in (("ED", 3, 4), ("BD", 3, 2), ("CALC", 1, 3)):
        scene.subject(code, kind="required", period=period, unit_id=99)
        for n in range(unlocks):
            scene.subject(
                f"{code}{n}",
                offer=False,
                kind="required",
                period=3,
                prerequisites=[[code]],
            )
    scene.component("CURRENT", period=2)
    scene.history("CURRENT", enrolled=True, term="2026.2")
    assert codes(scene.get()) == ["ED", "BD", "CALC"]
    assert scores(await ranked()) == [("ED", 109), ("BD", 99), ("CALC", 94)]


async def test_optativas_e_complementares_nao_ganham_bonus_de_tipo(scene, ranked):
    scene.subject("X", kind="required", period=1)
    scene.subject("OPT", kind="optional", period=9)
    scene.subject("COMP", kind="complementary", period=9, hours=59)
    for n in range(4):
        scene.subject(
            f"Y{n}", offer=False, kind="required", period=2, prerequisites=[["X"]]
        )
    assert codes(scene.get()) == ["X", "OPT", "COMP"]
    assert scores(await ranked()) == [("X", 114), ("OPT", 9), ("COMP", 8)]


async def test_empates_por_obrigatoria_periodo_positivo_e_codigo(scene, ranked):
    # Optativa com carga alta empata com obrigatórias atrasadas.
    scene.subject("R", kind="required", period=1, unit_id=99)
    scene.subject("Z", kind="required", period=2, unit_id=99)
    scene.subject("A", hours=960)
    scene.component("CURRENT", period=4)
    scene.history("CURRENT", term="2026.2", enrolled=True)
    assert codes(scene.get()) == ["R", "Z", "A"]
    assert scores(await ranked()) == [("R", 69), ("Z", 69), ("A", 69)]


def test_oferta_mais_recente_e_semestres_invalidos(scene):
    scene.subject("A")
    scene.subject("OLD", offer=False)
    with scene.db.begin() as session:
        session.add(Classroom(subject_code="OLD", number="01", semester="2025.2"))
        session.add(Classroom(subject_code="OLD", number="01", semester="invalid"))
    assert codes(scene.get()) == ["A"]


async def test_referencia_normalizada_da_matriz_conta_sem_oferta(scene, ranked):
    scene.subject("X", kind="required", period=1)
    scene.subject("Y", offer=False, prerequisites=[[" x "]])
    scene.component(" y ", period=2)
    assert codes(scene.get()) == ["X"]
    x = points(await ranked(), "X")
    assert x["chain_length"] == 10 and x["chain_width"] == 5


def test_modulo_livre_fica_de_fora_mesmo_da_unidade_ou_destravando(scene):
    scene.subject("FREE", kind=None)
    scene.subject(
        "UNLOCK", offer=False, kind="required", period=2, prerequisites=[["FREE"]]
    )
    scene.subject("OPTIONAL", kind="optional")
    scene.subject("COMPLEMENTARY", kind="complementary")
    assert codes(scene.get()) == ["COMPLEMENTARY", "OPTIONAL"]


async def test_bonus_do_proximo_periodo_e_pendente_do_atual_e_atrasada(scene, ranked):
    scene.subject("CURRENT_PENDING", kind="required", period=2)
    scene.subject("NEXT", kind="required", period=3)
    scene.subject("OLD", kind="required", period=1)
    scene.component("ENROLLED", period=2)
    scene.history("ENROLLED", term="2026.2", enrolled=True)
    assert codes(scene.get()) == ["NEXT", "OLD", "CURRENT_PENDING"]
    assert scores(await ranked()) == [
        ("NEXT", 84),
        ("OLD", 74),
        ("CURRENT_PENDING", 74),
    ]


async def test_sem_matricula_mira_o_periodo_pendente_inferido(scene, ranked):
    scene.subject("NEXT", kind="required", period=2)
    scene.component("DONE", period=1)
    scene.history("DONE", grade=Grade.MM)
    (item,) = scene.get()
    assert [r["code"] for r in reasons(item)] == [
        "required",
        "target_period",
        "same_unit",
        "hours",
    ]
    assert points(await ranked(), "NEXT") == {
        "required": 50,
        "target_period": 25,
        "same_unit": 5,
        "hours": 4,
    }
