import pytest
from sqlalchemy import func, select

from api.db.models import Classroom, Professor, Subject
from api.db.professors import save_classroom_professors
from api.db.seed.classrooms import CLASSROOMS_CSV, read_classrooms, seed_classrooms
from api.db.seed.subjects import SUBJECTS_CSV, read_subjects


def _csv(tmp_path, *lines):
    path = tmp_path / "classrooms.csv"
    path.write_text(
        "subject_code,number,semester,schedule,room,vacancies,occupied,professors\n"
        + "\n".join(lines)
        + "\n",
        encoding="utf-8",
    )
    return path


def test_csv_do_repositorio_aponta_para_componentes_que_existem():
    subjects = {subject.code for subject in read_subjects(SUBJECTS_CSV)}
    classrooms = read_classrooms(CLASSROOMS_CSV)

    assert classrooms
    assert {c.subject_code for c, _ in classrooms} <= subjects


def test_campos_vazios_ficam_nulos_e_turma_repetida_e_barulhenta(tmp_path):
    ((classroom, names),) = read_classrooms(_csv(tmp_path, " fga0001 ,01,2026.2,,,,,"))
    assert classroom.subject_code == "FGA0001"
    assert (classroom.schedule, classroom.room) == (None, None)
    assert (names, classroom.vacancies, classroom.occupied) == (
        [],
        None,
        None,
    )

    # Mesmo número em outro componente ou semestre é outra turma.
    read_classrooms(
        _csv(
            tmp_path,
            "FGA0001,01,2026.2,,,,,",
            "FGA0002,01,2026.2,,,,,",
            "FGA0001,01,2026.1,,,,,",
        )
    )
    with pytest.raises(ValueError, match="repetido"):
        read_classrooms(
            _csv(tmp_path, "fga0001,01,2026.2,,,,,", "FGA0001,01,2026.2,,,,,")
        )


async def test_seed_atualiza_so_docentes_e_vagas_e_ignora_componente_desconhecido(
    async_database, tmp_path
):
    async with async_database.begin() as session:
        session.add(Subject(code="FGA0001", name="A", unit_id=673))
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(
                tmp_path,
                "FGA0001,01,2026.2,35M12,S1,50,10,FULANO; CICLANO",
                "XYZ9999,01,2026.2,24T23,S2,50,10,",
            ),
        )
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(
                tmp_path,
                "FGA0001,01,2026.2,46T23,S9,60,12,BELTRANO",
                "FGA0001,02,2026.2,24T23,,50,10,",
            ),
        )

    async with async_database() as session:
        classrooms = (
            await session.scalars(select(Classroom).order_by(Classroom.number))
        ).all()
    assert [
        (
            c.number,
            c.schedule,
            c.room,
            [p.name for p in c.professors],
            c.vacancies,
            c.occupied,
        )
        for c in classrooms
    ] == [
        ("01", "35M12", "S1", ["BELTRANO"], 60, 12),
        ("02", "24T23", None, [], 50, 10),
    ]


async def test_docentes_de_muitas_turmas_sao_ligados_em_lotes(
    async_database, tmp_path, monkeypatch
):
    # com lotes de uma turma, cada consulta acha só a sua e nada se perde
    monkeypatch.setattr("api.db.seed.classrooms._LOOKUP_BATCH", 1)
    async with async_database.begin() as session:
        session.add(Subject(code="FGA0001", name="A", unit_id=673))
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(
                tmp_path,
                "FGA0001,01,2026.2,,,,,FULANO",
                "FGA0001,01,2027.1,,,,,CICLANO",
                "FGA0001,02,2027.1,,,,,BELTRANO",
            ),
        )

    async with async_database() as session:
        classrooms = (
            await session.scalars(
                select(Classroom).order_by(Classroom.semester, Classroom.number)
            )
        ).all()
    assert [(c.semester, [p.name for p in c.professors]) for c in classrooms] == [
        ("2026.2", ["FULANO"]),
        ("2027.1", ["CICLANO"]),
        ("2027.1", ["BELTRANO"]),
    ]


async def test_turmas_de_componente_desconhecido_sao_contadas_no_log(
    async_database, tmp_path, monkeypatch
):
    events = []
    monkeypatch.setattr(
        "api.db.seed.classrooms.event", lambda name, **fields: events.append(fields)
    )
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(tmp_path, "XYZ9999,01,2026.2,,,,,", "XYZ9998,01,2026.2,,,,,"),
        )

    assert [e["skipped_count"] for e in events] == [2]


async def test_seed_vincula_docentes_ao_catalogo_e_preserva_turma_sem_nomes(
    async_database, tmp_path
):
    async with async_database.begin() as session:
        session.add(Subject(code="FGA0001", name="A", unit_id=673))
        session.add(Professor(siape=1, name="José Araújo", unit_id=673))
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(
                tmp_path,
                "FGA0001,01,2026.2,,,,,JOSE ARAUJO; NOVO",
                "FGA0001,02,2026.2,,,,,",
            ),
        )
        vista = Professor(name="DA LISTA")
        session.add(vista)
        await session.flush()
        segunda = await session.scalar(
            select(Classroom).where(Classroom.number == "02")
        )
        await save_classroom_professors(session, {segunda.id: [vista]})
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(
                tmp_path,
                "FGA0001,01,2026.2,,,,,JOSE ARAUJO; NOVO",
                "FGA0001,02,2026.2,,,,,",
            ),
        )

    async with async_database() as session:
        classrooms = (
            await session.scalars(select(Classroom).order_by(Classroom.number))
        ).all()
        professors = await session.scalar(select(func.count()).select_from(Professor))
    assert [[(p.siape, p.name) for p in c.professors] for c in classrooms] == [
        [(1, "José Araújo"), (None, "NOVO")],
        [(None, "DA LISTA")],
    ]
    # O docente fora do catálogo não é recriado a cada seed.
    assert professors == 3


async def test_seed_inativa_turmas_antigas_sem_apagar_historico_ou_referencias(
    async_database, tmp_path
):
    async with async_database.begin() as session:
        session.add(Subject(code="FGA0001", name="A", unit_id=673))
        old = Classroom(subject_code="FGA0001", number="01", semester="2025.2")
        # aberta por algum aluno: o frontEndIdTurma diz que alguém a viu, não quem
        mine = Classroom(
            subject_code="FGA0001", number="02", semester="2025.2", front_end_id="X"
        )
        stats = Classroom(
            subject_code="FGA0001",
            number="03",
            semester="2025.2",
            statistics=[{"situation": "aprovado", "percentage": 90}],
        )
        session.add_all([old, mine, stats])
    async with async_database.begin() as session:
        await seed_classrooms(
            session,
            _csv(tmp_path, "FGA0001,01,2026.2,,,,,", "FGA0001,01,2027.1,,,,,"),
        )

    async with async_database() as session:
        kept = (
            await session.execute(
                select(Classroom.semester, Classroom.number).order_by(
                    Classroom.semester, Classroom.number
                )
            )
        ).all()
    assert kept == [
        ("2025.2", "01"),
        ("2025.2", "02"),
        ("2025.2", "03"),
        ("2026.2", "01"),
        ("2027.1", "01"),
    ]
    async with async_database() as session:
        assert not await session.scalar(
            select(Classroom.offer_active).where(
                Classroom.semester == "2025.2", Classroom.number == "01"
            )
        )
