import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]


@pytest.mark.skipif(
    not shutil.which("powershell"), reason="utilitário local do Windows"
)
def test_limpeza_preserva_dados_e_segredos_e_remove_so_cache(tmp_path):
    script = tmp_path / "scripts/project-size.ps1"
    script.parent.mkdir()
    shutil.copyfile(ROOT / "scripts/project-size.ps1", script)
    protected = [
        ".local/pgdata/registro",
        ".local/materials/arquivo",
        ".local/cloudbeaver/workspace/conta",
        "apps/api/.env",
        "docs/HANDOFF.md",
        ".venv/Lib/site-packages/pacote/__init__.py",
    ]
    for relative in protected + [
        ".pytest_cache/temporario",
        "apps/web/.output/temporario",
        ".venv/Lib/site-packages/pacote/__pycache__/arquivo.pyc",
    ]:
        file = tmp_path / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text("conteudo preservado", encoding="utf-8")
    result = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-Clean",
        ],
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    assert all(
        (tmp_path / path).read_text(encoding="utf-8") == "conteudo preservado"
        for path in protected
    )
    assert not (tmp_path / ".pytest_cache").exists()
    assert not (tmp_path / "apps/web/.output").exists()
    assert not (tmp_path / ".venv/Lib/site-packages/pacote/__pycache__").exists()
    assert b"Total:" in result.stdout
    assert b"GetCompressedFileSizeW" in result.stdout
