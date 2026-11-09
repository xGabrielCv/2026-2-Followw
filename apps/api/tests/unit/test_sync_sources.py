"""Coletor do catálogo como processo separado: sucesso, falha, tempo limite e fonte ausente."""

import time

import pytest

from api.modules.sync import sources


@pytest.fixture
def script(tmp_path, monkeypatch):
    def criar(codigo: str):
        arquivo = tmp_path / "update_data.py"
        arquivo.write_text(codigo, encoding="utf-8")
        monkeypatch.setattr(sources, "SCRIPT", arquivo)

    dados = tmp_path / "data"
    dados.mkdir()
    (dados / "classrooms.csv").write_text("a,b\n1,2\n3,4\n", encoding="utf-8")
    monkeypatch.setattr(sources, "DATA", dados)
    monkeypatch.setattr(sources, "PROFESSORS", tmp_path / "nao-existe.csv")
    monkeypatch.setattr(sources, "ROOT", tmp_path)
    return criar


async def test_sucesso_devolve_resumo_e_contagem(script):
    script("print('ok')")
    resultado = await sources.run_catalog(30)
    assert resultado.status == "success"
    assert resultado.records == 2
    assert len(resultado.content_hash) == 64


async def test_resumo_muda_so_quando_o_arquivo_muda(script, tmp_path):
    script("print('ok')")
    primeiro = await sources.run_catalog(30)
    igual = await sources.run_catalog(30)
    (tmp_path / "data" / "classrooms.csv").write_text("a,b\n1,2\n", encoding="utf-8")
    diferente = await sources.run_catalog(30)
    assert primeiro.content_hash == igual.content_hash != diferente.content_hash


async def test_falha_guarda_codigo_e_ultima_linha_sem_credencial(script):
    script(
        "import sys\n"
        "print('postgresql://followw_app:segredo123@127.0.0.1/db recusou')\n"
        "sys.exit(3)\n"
    )
    resultado = await sources.run_catalog(30)
    assert resultado.status == "failed"
    assert resultado.error.startswith("Código 3:")
    assert "segredo123" not in resultado.error


async def test_tempo_limite_encerra_o_coletor_e_nao_a_api(script):
    script("import time\ntime.sleep(60)\n")
    inicio = time.monotonic()
    resultado = await sources.run_catalog(1)
    assert time.monotonic() - inicio < 20
    assert resultado.status == "failed"
    assert "limite" in resultado.error


async def test_sem_script_a_fonte_e_ignorada_sem_falhar(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "SCRIPT", tmp_path / "ausente.py")
    resultado = await sources.run_catalog(30)
    assert resultado.status == "skipped"
