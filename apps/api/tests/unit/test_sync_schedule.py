from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from api.modules.sync.schedule import SOURCES, SyncSettings, backoff, next_run
from api.modules.sync.sources import summarize

PADRAO = SyncSettings().catalog_times


def brasilia(hora, minuto=0, dia=9):
    # Brasília é UTC-3 o ano todo (sem horário de verão)
    return datetime(2026, 11, dia, hora, minuto, tzinfo=UTC) + timedelta(hours=3)


def test_padrao_sao_tres_execucoes_por_dia_em_brasilia():
    assert PADRAO == ["00:00", "08:00", "16:00"]
    assert SyncSettings().restaurant_time == "06:00"


@pytest.mark.parametrize(
    ("agora", "esperado"),
    [
        (brasilia(7, 59), brasilia(8)),
        (brasilia(8), brasilia(16)),  # estritamente depois
        (brasilia(16, 1), brasilia(0, dia=10)),
        (brasilia(0, 0), brasilia(8)),
        (brasilia(23, 59), brasilia(0, dia=10)),
    ],
)
def test_proximo_horario_usa_o_relogio_de_brasilia(agora, esperado):
    assert next_run(agora, PADRAO) == esperado


def test_proximo_horario_nao_depende_do_fuso_de_quem_pergunta():
    utc = datetime(2026, 11, 9, 12, 0, tzinfo=UTC)  # 09:00 em Brasília
    outro = utc.astimezone(ZoneInfo("Asia/Tokyo"))
    assert next_run(utc, PADRAO) == next_run(outro, PADRAO) == brasilia(16)


def test_rejeita_horarios_invalidos_repetidos_ou_colados():
    for horarios in (
        ["24:00"],
        ["8:00"],
        ["08:60"],
        ["08:00", "08:00"],
        ["08:00", "08:30"],
        [],
    ):
        with pytest.raises(ValidationError):
            SyncSettings(catalog_times=horarios)


def test_horarios_sao_ordenados():
    assert SyncSettings(catalog_times=["16:00", "00:00"]).catalog_times == [
        "00:00",
        "16:00",
    ]


@pytest.mark.parametrize(
    "campo",
    [
        {"timeout_seconds": 10},
        {"timeout_seconds": 10**6},
        {"backoff_minutes": 1},
        {"max_backoff_hours": 48},
        {"manual_cooldown_seconds": 5},
        {"history_limit": 5},
        {"startup_max_age_hours": 0},
    ],
)
def test_limites_seguros_do_backend(campo):
    with pytest.raises(ValidationError):
        SyncSettings(**campo)


def test_campos_desconhecidos_sao_recusados():
    with pytest.raises(ValidationError):
        SyncSettings(comando="rm -rf /")


def test_somente_fontes_conhecidas():
    assert set(SOURCES) == {"catalog", "restaurant"}


def test_espera_dobra_a_cada_falha_ate_o_teto():
    s = SyncSettings(backoff_minutes=15, max_backoff_hours=2)
    assert [backoff(n, s) for n in (1, 2, 3, 4, 9)] == [
        timedelta(minutes=15),
        timedelta(minutes=30),
        timedelta(minutes=60),
        timedelta(minutes=120),
        timedelta(hours=2),
    ]


def test_resumo_do_erro_nao_vaza_credencial_de_url():
    saida = "x\nFalha em postgresql://followw_app:segredo123@127.0.0.1:5432/followw\n"
    resumo = summarize(saida)
    assert "segredo123" not in resumo
    assert "***@" in resumo
    assert len(summarize("a" * 1000)) == 300
