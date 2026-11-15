import json
from datetime import date

from api import academic_calendar


def test_calendario_coletado_publico_muda_versao_e_nao_exige_configuracao_manual(
    client, tmp_path, monkeypatch
):
    path = tmp_path / "calendar.json"
    monkeypatch.setattr(academic_calendar, "COLLECTED_CALENDAR", path)
    before = client.get("/public/config/version").json()["parts"]["config"]
    entry = {
        "semester": "2033.2",
        "name": "Segundo semestre",
        "period": {"start": "2033-08-08", "end": "2033-12-15"},
        "classes": {
            "start": "2033-08-08",
            "end": "2033-12-15",
            "instructional_days": 100,
        },
        "events": [],
    }
    path.write_text(json.dumps({"semesters": {"2033.2": entry}}), encoding="utf-8")
    response = client.get("/public/config").json()
    assert response["calendar"]["2033.2"] == entry
    assert client.get("/public/config/version").json()["parts"]["config"] != before
    assert academic_calendar.current_regular_semester(date(2033, 9, 10)) == "2033.2"
    assert academic_calendar.semester_progress_percent(date(2033, 9, 10)) is not None


def test_arquivo_de_calendario_invalido_nao_derruba_config_publica(
    client, tmp_path, monkeypatch
):
    path = tmp_path / "calendar.json"
    monkeypatch.setattr(academic_calendar, "COLLECTED_CALENDAR", path)
    path.write_text('{"semesters": false}', encoding="utf-8")
    assert client.get("/public/config").status_code == 200
    assert client.get("/public/config").json()["calendar"] == {}
