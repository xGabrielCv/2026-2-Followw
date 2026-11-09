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
