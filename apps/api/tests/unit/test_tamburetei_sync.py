"""Testes unitários do sync local Tamburetei (diff, 2 backups, allowlist) e leitura pública."""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest

from api import tamburetei

ROOT = Path(__file__).resolve().parents[4]
SCRIPT_PATH = ROOT / "scripts" / "sync_tamburetei.py"


def _load_sync_module():
    spec = importlib.util.spec_from_file_location("sync_tamburetei_mod", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["sync_tamburetei_mod"] = module
    spec.loader.exec_module(module)
    return module


def _sample_remote(version: int = 1) -> dict[str, object]:
    pas = {
        "ciclo": "2023-2025",
        "sistema": "Sistema Universal",
        "url": "https://cdn.cebraspe.org.br/pas/2023-2025.pdf",
        "modalidades": [
            {"id": "universal", "sistema": "Sistema Universal", "descricao": "Ampla"}
        ],
        "registros": [
            {
                "nome": "Administração",
                "campus": "Darcy Ribeiro",
                "grau": "Bacharelado",
                "graus": ["Bacharelado"],
                "turno": "Diurno",
                "minimo": f"{38.0 + version:.3f}",
                "maximo": "95.000",
                "pagina": 1,
                "cotas": {
                    "universal": {
                        "minimo": f"{38.0 + version:.3f}",
                        "maximo": "95.000",
                    }
                },
            },
            {
                "nome": "Engenharias",
                "campus": "FCTE",
                "grau": "Bacharelado",
                "graus": ["Bacharelado"],
                "turno": "Diurno",
                "minimo": "12.500",
                "pagina": 4,
                "ingressoConjunto": True,
                "ofertaOriginal": "ENGENHARIAS (BACHARELADO)",
                "cotas": {},
            },
        ],
    }
    pas_old = {
        **pas,
        "ciclo": "2022-2024",
        "registros": [
            {
                **pas["registros"][0],
                "minimo": "34.000",
            }
        ],
    }
    return {
        "cursos": [
            {
                "codigo_mec": None,
                "nome": "Administração",
                "campus": "Darcy Ribeiro",
                "grau": "Bacharelado",
                "turno": "Diurno",
                "slug": "administracao-diurno",
                "modalidade": "Presencial",
                "metricas_recentes": {
                    "ano": 2024,
                    "ingressantes": 255,
                    "matriculados": 1193 + version,
                    "concluintes": 178,
                    "trancados": 58,
                    "desvinculados": 64,
                    "taxa_sucesso": 69.8,
                    "taxa_evasao": 5.36,
                },
                "metricas_historicas": [
                    {
                        "ano": 2024,
                        "ingressantes": 255,
                        "matriculados": 1193 + version,
                        "concluintes": 178,
                        "trancados": 58,
                        "desvinculados": 64,
                        "taxa_sucesso": 69.8,
                        "taxa_evasao": 5.36,
                    }
                ],
            }
        ],
        "cadeiras": [
            {
                "codigo": "CIC0004",
                "nome": "ALGORITMOS E PROGRAMACAO DE COMPUTADORES",
                "departamento": "CIC",
                "campus": "Darcy Ribeiro",
                "metrica_consolidada": {
                    "matriculados": 100,
                    "aprovados": 70,
                    "reprovados_nota": 15,
                    "reprovados_falta": 5,
                    "trancamentos": 10,
                    "taxa_aprovacao_acumulada": 70.0,
                    "total_turmas_suprimidas": 0,
                },
                "metricas": [
                    {
                        "ano": 2024,
                        "semestre": 2,
                        "matriculados": 100,
                        "aprovados": 70,
                        "reprovados_nota": 15,
                        "reprovados_falta": 5,
                        "trancamentos": 10,
                        "taxa_aprovacao": 70.0,
                        "amostragem_suprimida_lgpd": False,
                    }
                ],
            },
            {
                "codigo": "CEL0050",
                "nome": "MICROBIOLOGIA",
                "departamento": "CEL",
                "campus": None,
                "metrica_consolidada": {
                    "matriculados": 2,
                    "aprovados": 2,
                    "reprovados_nota": 0,
                    "reprovados_falta": 0,
                    "trancamentos": 0,
                    "taxa_aprovacao_acumulada": None,
                    "total_turmas_suprimidas": 1,
                },
                "metricas": [
                    {
                        "ano": 2024,
                        "semestre": 2,
                        "matriculados": 2,
                        "amostragem_suprimida_lgpd": True,
                    }
                ],
            },
            {
                "codigo": "SEM0001",
                "nome": "SEM METRICAS",
                "metrica_consolidada": None,
                "metricas": [],
            },
        ],
        "dashboard": {
            "total_cursos": 161,
            "total_campi": 4,
            "ingressantes": 35116,
            "matriculados": 175914,
            "concluintes": 20935,
            "trancados": 10087,
            "evadidos": 6262,
            "taxa_media_formacao": 60.15,
            "taxa_media_evasao": 3.49,
            "resumo_campi": [
                {
                    "campus": "Darcy Ribeiro",
                    "matriculados": 146750,
                    "desvinculados": 5286,
                    "taxa_evasao": 3.6,
                    "taxa_media_anual": 3.55,
                }
            ],
        },
        "pas-2023-2025.json": pas,
        "pas-2022-2024.json": pas_old,
        "pas-2021-2023.json": {**pas_old, "ciclo": "2021-2023", "registros": []},
        "pas-2020-2022.json": {**pas_old, "ciclo": "2020-2022", "registros": []},
        "pas-2019-2021.json": {**pas_old, "ciclo": "2019-2021", "registros": []},
        "pas-2018-2020.json": {**pas_old, "ciclo": "2018-2020", "registros": []},
    }


def _mock_client(version_box: list[int]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        data = _sample_remote(version_box[0])
        if request.url.path == "/cursos":
            return httpx.Response(200, json=data["cursos"])
        if request.url.path == "/cadeiras":
            return httpx.Response(200, json=data["cadeiras"])
        if request.url.path == "/dashboard/geral":
            return httpx.Response(200, json=data["dashboard"])
        filename = request.url.path.rsplit("/", 1)[-1]
        if filename in data:
            return httpx.Response(200, json=data[filename])
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_sync_descarta_quando_sem_mudanca_e_mantem_no_maximo_dois_backups(tmp_path):
    mod = _load_sync_module()
    version = [1]
    base_time = datetime(2026, 11, 25, 3, 0, tzinfo=UTC)

    with _mock_client(version) as client:
        first = mod.sync_tamburetei(
            output_dir=tmp_path, max_backups=2, client=client, now=base_time
        )
        assert first["status"] == "updated"
        assert first["changed"] is True
        assert first["subjects"] == 2  # SEM0001 sem métricas foi filtrada
        assert list((tmp_path / "backups").glob("*.json")) == []

        # Sem mudança real: descarta e não gera backup
        same = mod.sync_tamburetei(
            output_dir=tmp_path,
            max_backups=2,
            client=client,
            now=base_time + timedelta(hours=1),
        )
        assert same["status"] == "unchanged"
        assert same["changed"] is False
        assert same["content_hash"] == first["content_hash"]
        assert list((tmp_path / "backups").glob("*.json")) == []

        # Com --if-stale-hours=24 pula rede
        fresh = mod.sync_tamburetei(
            output_dir=tmp_path,
            if_stale_hours=24,
            max_backups=2,
            client=client,
            now=base_time + timedelta(hours=2),
        )
        assert fresh["status"] == "skipped_fresh"

        # 3 atualizações com mudanças reais -> mantém no máximo 2 backups rotativos
        for step in (2, 3, 4):
            version[0] = step
            updated = mod.sync_tamburetei(
                output_dir=tmp_path,
                max_backups=2,
                client=client,
                now=base_time + timedelta(days=step),
            )
            assert updated["status"] == "updated"
        backups = sorted((tmp_path / "backups").glob("snapshot-*.json"))
        assert len(backups) == 2


def test_sync_rejeita_host_fora_da_allowlist():
    mod = _load_sync_module()
    with httpx.Client() as client:
        with pytest.raises(ValueError, match="Host não permitido"):
            mod.fetch_json(client, "http://api.tambureteiunb.com.br/cursos")
        with pytest.raises(ValueError, match="Host não permitido"):
            mod.fetch_json(client, "https://evil.example/cursos")


def test_sync_faz_retry_quando_tamburetei_responde_429():
    mod = _load_sync_module()
    tentativas = [0]

    def handler(_request: httpx.Request) -> httpx.Response:
        tentativas[0] += 1
        if tentativas[0] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"ok": True})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        resultado = mod.fetch_json(client, "https://api.tambureteiunb.com.br/cursos")
    assert resultado == {"ok": True}
    assert tentativas[0] == 2


def test_leitor_tamburetei_calcula_media_pas_dpo_e_respeita_supressao_lgpd(
    tmp_path, monkeypatch
):
    mod = _load_sync_module()
    version = [1]
    with _mock_client(version) as client:
        mod.sync_tamburetei(output_dir=tmp_path, client=client)

    monkeypatch.setattr(tamburetei, "SNAPSHOT_PATH", tmp_path / "snapshot.json")
    monkeypatch.setattr(tamburetei, "_CACHE_KEY", None)
    monkeypatch.setattr(tamburetei, "_CACHE_DATA", None)

    detail = tamburetei.course_indicators(
        course_id=10,
        name="ADMINISTRAÇÃO",
        shift="DIURNO",
        unit_code="ADM",
        unit_name="Depto Administração - Brasília",
        degree="Bacharelado",
    )
    assert detail.pas_latest == 39.0
    assert detail.pas_cycle == "2023-2025"
    assert detail.pas_average == 36.5  # média de 39.0 e 34.0
    assert len(detail.pas_history) == 2
    assert detail.latest_metrics is not None
    assert detail.latest_metrics.matriculados == 1194
    assert detail.latest_metrics.taxa_evasao == 5.36

    # Ingresso conjunto FCTE (Engenharia de Software)
    fcte = tamburetei.course_indicators(
        course_id=20,
        name="ENGENHARIA DE SOFTWARE",
        shift="DIURNO",
        unit_code="FCTE",
        unit_name="Faculdade de Ciências e Tecnologias em Engenharia",
    )
    assert fcte.pas_latest == 12.5
    assert fcte.pas_average == 12.5

    # EaD não casa com PAS presencial
    ead = tamburetei.course_indicators(
        course_id=30,
        name="ADMINISTRAÇÃO",
        shift="DIURNO",
        unit_code="ADM",
        unit_name="Depto Administração",
        modality="A Distância",
    )
    assert ead.pas_history == []
    assert ead.latest_metrics is None

    # Disciplina válida e disciplina suprimida por LGPD
    cic = tamburetei.subject_external_outcomes("CIC0004")
    assert cic is not None
    assert cic.approved == 70.0
    assert cic.failed == 20.0
    assert cic.dropped == 10.0
    assert cic.enrolled == 100
    assert cic.semesters == ["2024.2"]
    assert tamburetei.subject_external_outcomes("CEL0050") is None

    # Dashboard geral
    dash = tamburetei.dashboard_summary()
    assert dash is not None
    assert dash.total_cursos == 161
    assert dash.taxa_media_evasao == 3.49

    # Snapshot ausente: fallback seguro sem erro
    monkeypatch.setattr(tamburetei, "SNAPSHOT_PATH", tmp_path / "nao-existe.json")
    assert tamburetei.dashboard_summary() is None
    assert tamburetei.subject_external_outcomes("CIC0004") is None
    assert (
        json.loads(
            tamburetei.course_indicators(
                course_id=1, name="X", shift=None, unit_code=None, unit_name=None
            ).model_dump_json()
        )["pas_history"]
        == []
    )


def test_taxa_sucesso_acima_de_100_em_ingresso_conjunto_e_descartada():
    # Cursos de ingresso conjunto (ex.: Engenharias FCTE) têm poucos ingressantes diretos no DPO,
    # gerando razão concluintes/ingressantes > 100% (ex.: 4050%); descartamos valores fora de [0, 100].
    parsed = tamburetei._parse_year_metrics(
        {
            "ano": 2024,
            "ingressantes": 2,
            "matriculados": 1140,
            "concluintes": 81,
            "taxa_sucesso": 4050.0,
            "taxa_evasao": 4.1,
        }
    )
    assert parsed is not None
    assert parsed.taxa_sucesso is None
    assert parsed.taxa_evasao == 4.1


def test_tamburetei_respeita_env_data_dir_e_muda_versao_quando_snapshot_atualiza(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("TAMBURETEI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(tamburetei, "SNAPSHOT_PATH", tamburetei._DEFAULT_SNAPSHOT_PATH)
    monkeypatch.setattr(tamburetei, "_CACHE_KEY", None)
    monkeypatch.setattr(tamburetei, "_CACHE_DATA", None)

    assert tamburetei.resolve_snapshot_path() == tmp_path / "snapshot.json"
    assert tamburetei.snapshot_version() == "missing"

    snap = tmp_path / "snapshot.json"
    snap.write_text('{"updated_at":"2028-01-01T00:00:00Z"}', encoding="utf-8")
    v1 = tamburetei.snapshot_version()
    assert v1 != "missing"
    assert tamburetei.snapshot_updated_at() == "2028-01-01T00:00:00Z"

    snap.write_text(
        '{"updated_at":"2028-06-01T00:00:00Z","courses":[]}', encoding="utf-8"
    )
    assert tamburetei.snapshot_version() != v1
