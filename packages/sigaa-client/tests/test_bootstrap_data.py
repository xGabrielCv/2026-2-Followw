import hashlib
import importlib.util
from pathlib import Path

import httpx
import pytest
import respx

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location(
    "bootstrap_data", ROOT / "scripts/bootstrap_data.py"
)
bootstrap_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap_data)


def test_importa_catalogo_verificado_sem_sobrescrever_dados_locais(
    tmp_path, monkeypatch
):
    content = b"id,name\n1,Unidade\n"
    monkeypatch.setattr(
        bootstrap_data, "CHECKSUMS", {"units.csv": hashlib.sha256(content).hexdigest()}
    )
    with respx.mock() as router:
        request = router.get(f"{bootstrap_data.BASE}/units.csv").mock(
            return_value=httpx.Response(200, content=content)
        )
        bootstrap_data.bootstrap(tmp_path)
        assert (tmp_path / "units.csv").read_bytes() == content
        (tmp_path / "units.csv").write_bytes(b"dados locais")
        bootstrap_data.bootstrap(tmp_path)
        assert request.call_count == 1
        assert (tmp_path / "units.csv").read_bytes() == b"dados locais"


def test_integridade_invalida_nao_grava_catalogo_parcial(tmp_path, monkeypatch):
    monkeypatch.setattr(
        bootstrap_data,
        "CHECKSUMS",
        {"units.csv": hashlib.sha256(b"ok").hexdigest(), "courses.csv": "0" * 64},
    )
    with respx.mock() as router:
        router.get(f"{bootstrap_data.BASE}/units.csv").mock(
            return_value=httpx.Response(200, content=b"ok")
        )
        router.get(f"{bootstrap_data.BASE}/courses.csv").mock(
            return_value=httpx.Response(200, content=b"alterado")
        )
        with pytest.raises(ValueError, match="integridade"):
            bootstrap_data.bootstrap(tmp_path)
        assert not list(tmp_path.iterdir())
