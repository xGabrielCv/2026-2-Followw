import api


def test_comando_api_so_escuta_na_propria_maquina_por_padrao(monkeypatch):
    chamadas = []
    monkeypatch.setattr(
        api.uvicorn, "run", lambda *args, **kwargs: chamadas.append(kwargs)
    )
    monkeypatch.delenv("API_HOST", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    api.main()
    assert chamadas[0]["host"] == "127.0.0.1"
    assert chamadas[0]["reload"] is True


def test_bind_aberto_exige_escolha_explicita_e_producao_nao_recarrega(monkeypatch):
    chamadas = []
    monkeypatch.setattr(
        api.uvicorn, "run", lambda *args, **kwargs: chamadas.append(kwargs)
    )
    monkeypatch.setenv("API_HOST", "0.0.0.0")
    monkeypatch.setenv("ENVIRONMENT", "production")
    api.main()
    assert chamadas[0]["host"] == "0.0.0.0"
    assert chamadas[0]["reload"] is False
