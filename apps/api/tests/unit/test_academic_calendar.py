from datetime import UTC, date, datetime

import pytest

from api.academic_calendar import (
    class_days,
    grades_closed,
    member_status,
    members_closed,
    members_frozen,
)
from api.db.enums import ClassroomStatus


@pytest.mark.parametrize(
    ("dia", "encerrada"), [(date(2026, 12, 21), False), (date(2026, 12, 22), True)]
)
def test_participantes_encerram_tres_dias_depois_do_fim_do_semestre(
    hoje, dia, encerrada
):
    hoje(dia)

    assert members_closed("2026.2") is encerrada


@pytest.mark.parametrize(
    ("synced_at", "congelada"),
    [
        (datetime(2026, 12, 18, tzinfo=UTC), False),
        # 21/12 às 23h em Brasília: ainda na tolerância.
        (datetime(2026, 12, 22, 2, tzinfo=UTC), False),
        (datetime(2026, 12, 22, 3, tzinfo=UTC), True),
    ],
)
def test_participantes_congelam_no_primeiro_sync_depois_da_tolerancia(
    hoje, synced_at, congelada
):
    hoje(date(2026, 12, 30))

    assert members_frozen("2026.2", synced_at) is congelada


def test_semestre_fora_do_calendario_usa_a_ordem_dos_semestres():
    assert members_frozen("2025.2", datetime(2025, 1, 1, tzinfo=UTC))
    assert member_status("2025.2") == ClassroomStatus.CONCLUIDO
    assert not members_closed("2030.1")
    assert member_status("2030.1") == ClassroomStatus.CURSANDO


@pytest.mark.parametrize(
    ("dia", "encerrada"), [(date(2026, 7, 24), False), (date(2026, 7, 25), True)]
)
def test_mencao_encerra_tres_dias_depois_da_consolidacao(hoje, dia, encerrada):
    hoje(dia)

    assert grades_closed("2026.1") is encerrada


def test_dias_letivos_excluem_feriado_e_semana_universitaria():
    days = set(class_days("2026.2"))
    assert date(2026, 8, 10) in days
    assert date(2026, 9, 7) not in days
    assert date(2026, 9, 21) not in days


def test_dias_letivos_cobrem_o_semestre_inteiro_e_so_existem_no_calendario():
    days = list(class_days("2026.2"))
    assert (days[0], days[-1]) == (date(2026, 8, 10), date(2026, 12, 14))
    assert list(class_days("2099.1")) == []


@pytest.mark.parametrize(
    ("dia", "esperado"),
    [
        (date(2028, 2, 5), "2027.2"),
        (date(2028, 3, 15), "2028.1"),
        (date(2029, 9, 10), "2029.2"),
        (date(2035, 1, 20), "2034.2"),
    ],
)
def test_estima_semestres_regulares_apos_calendario_estatico(hoje, dia, esperado):
    from api.academic_calendar import (
        current_regular_semester,
        estimate_regular_semester,
    )

    hoje(dia)
    assert estimate_regular_semester(dia) == esperado
    assert current_regular_semester() == esperado


def test_calendario_mesclado_controla_matricula_e_progresso(hoje):
    import json

    from api.academic_calendar import (
        is_enrollment_period,
        merged_calendar,
        semester_progress_percent,
    )

    custom = {
        "2030.1": {
            "semester": "2030.1",
            "name": "2030.1",
            "period": {"start": "2030-03-01", "end": "2030-07-15"},
            "classes": {
                "start": "2030-03-01",
                "end": "2030-07-10",
                "instructional_days": 100,
            },
            "events": [
                {
                    "id": "enrollment",
                    "name": "Matrícula regular",
                    "start_date": "2030-03-01",
                    "end_date": "2030-03-05",
                    "category": "enrollment",
                }
            ],
        }
    }
    cal = merged_calendar(json.dumps(custom))
    hoje(date(2030, 3, 3))
    assert is_enrollment_period("2030.1", calendar=cal) is True
    hoje(date(2030, 5, 10))
    assert is_enrollment_period("2030.1", calendar=cal) is False
    assert semester_progress_percent(calendar=cal) >= 50
