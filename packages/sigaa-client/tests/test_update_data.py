import importlib.util
import subprocess
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location(
    "update_data", ROOT / "scripts" / "update_data.py"
)
update_data = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(update_data)

HEADER = "subject_code,number,semester,schedule,room,vacancies,occupied,professors\n"


def _csv(path: Path, *rows: str) -> Path:
    path.write_text(HEADER + "".join(f"{row}\n" for row in rows), encoding="utf-8")
    return path


def test_semestre_atual_e_o_proximo_pelo_calendario():
    assert update_data.regular_semesters(date(2026, 11, 8)) == ("2026.2", "2027.1")
    # nas férias de verão vale o último regular
    assert update_data.regular_semesters(date(2027, 1, 20)) == ("2026.2", "2027.1")
    assert update_data.regular_semesters(date(2027, 3, 1)) == ("2027.1", "2027.2")


def test_atualizacao_das_matrizes_e_semanal_sem_cadastrar_semestre(
    tmp_path, monkeypatch
):
    from datetime import UTC, datetime, timedelta

    calls = []
    monkeypatch.setattr(update_data, "STRUCTURE_UPDATED", tmp_path / "updated")
    monkeypatch.setattr(update_data, "LOCAL", tmp_path)
    monkeypatch.setattr(update_data, "run", lambda *args: calls.append(args))
    now = datetime(2033, 11, 10, tzinfo=UTC)
    update_data.refresh_structure(now)
    update_data.refresh_structure(now + timedelta(days=6))
    assert len(calls) == 1
    assert calls[0][-1].name == "collect_curricula.py"
    update_data.refresh_structure(now + timedelta(days=7))
    assert len(calls) == 2


async def test_calendario_coletado_futuro_e_usado_e_falha_preserva_arquivo(
    tmp_path, monkeypatch
):
    from unb_browser import AcademicCalendar, SemesterCalendar, UnbParseError

    path = tmp_path / "calendar.json"
    monkeypatch.setattr(update_data, "CALENDAR", path)
    entry = SemesterCalendar.model_validate(
        {
            "semester": "2033.2",
            "name": "Segundo semestre",
            "period": {"start": "2033-08-08", "end": "2033-12-15"},
            "classes": {
                "start": "2033-08-08",
                "end": "2033-12-15",
                "instructional_days": 100,
            },
        }
    )

    async def fetch(_self):
        return AcademicCalendar(semesters={entry.semester: entry})

    from unb_browser.calendar import Calendar

    monkeypatch.setattr(Calendar, "fetch_periods", fetch)
    await update_data.refresh_calendar()
    assert update_data.regular_semesters(date(2033, 9, 10)) == ("2033.2", "2034.1")
    before = path.read_bytes()

    async def unavailable(_self):
        raise UnbParseError("Fonte mudou")

    monkeypatch.setattr(Calendar, "fetch_periods", unavailable)
    await update_data.refresh_calendar()
    assert path.read_bytes() == before


def test_juncao_troca_so_as_linhas_do_semestre_e_mantem_a_ordem(tmp_path):
    base = _csv(
        tmp_path / "base.csv",
        "FGA0001,01,2026.2,,,10,5,",
        "FGA0002,01,2027.1,,,10,5,ANTIGA",
    )
    new = _csv(
        tmp_path / "new.csv", "FGA0002,01,2027.1,,,10,7,NOVA", "FGA0000,01,2027.1,,,,,"
    )

    update_data.merge_offer(base, new, "2027.1")

    assert base.read_text(encoding="utf-8").splitlines()[1:] == [
        "FGA0000,01,2027.1,,,,,",
        "FGA0001,01,2026.2,,,10,5,",
        "FGA0002,01,2027.1,,,10,7,NOVA",
    ]


def test_poda_deixa_so_o_semestre_atual_e_o_proximo(tmp_path, monkeypatch):
    base = _csv(
        tmp_path / "classrooms.csv",
        "FGA0001,01,2026.1,,,,,",
        "FGA0001,01,2026.2,,,,,",
        "FGA0001,01,2027.1,,,,,",
    )
    monkeypatch.setattr(update_data, "CLASSROOMS", base)

    update_data.prune_offer({"2026.2", "2027.1"})

    assert [line.split(",")[2] for line in base.read_text().splitlines()[1:]] == [
        "2026.2",
        "2027.1",
    ]


def test_falha_de_coleta_nao_e_tratada_como_oferta_ausente(monkeypatch):
    def falhar(*args, **kwargs):
        raise subprocess.CalledProcessError(1, ["coletor"])

    monkeypatch.setattr(update_data, "run", falhar)
    with pytest.raises(subprocess.CalledProcessError):
        update_data.collect_offer("2026.2")


def test_resposta_vazia_nao_substitui_ultimo_csv_valido(tmp_path):
    base = _csv(tmp_path / "base.csv", "FGA0001,01,2026.2,,,10,5,")
    new = _csv(tmp_path / "new.csv")
    before = base.read_bytes()
    with pytest.raises(ValueError):
        update_data.merge_offer(base, new, "2026.2")
    assert base.read_bytes() == before


def test_atualizacao_manual_de_matrizes_busca_componentes_depois_da_coleta(
    tmp_path, monkeypatch
):
    calls = []
    monkeypatch.setattr(
        update_data.sys, "argv", ["update_data.py", "--curricula-only", "--no-load"]
    )
    monkeypatch.setattr(update_data, "LOCAL", tmp_path)
    monkeypatch.setattr(update_data, "STATE", tmp_path / "update.json")
    monkeypatch.setattr(update_data, "run", lambda *args: calls.append(args))
    update_data.main()
    assert [args[1].name for args in calls] == [
        "collect_curricula.py",
        "collect_subjects.py",
    ]
