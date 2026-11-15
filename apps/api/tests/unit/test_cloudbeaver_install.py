import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
SPEC = importlib.util.spec_from_file_location(
    "configure_cloudbeaver", ROOT / "scripts/configure_cloudbeaver.py"
)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)


class Banco:
    def __init__(self):
        self.commands = []
        self.existing = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def execute(self, query, params=None):
        self.commands.append((query, params))
        if isinstance(query, str):
            if "pg_roles" in query or "pg_policies" in query:
                self.result = (1,) if self.existing else None
            elif "relrowsecurity" in query:
                self.result = (True,)
            elif "to_regclass" in query:
                self.result = ("public.subjects",)
        return self

    def fetchone(self):
        return self.result


@pytest.fixture
def instalacao(tmp_path, monkeypatch):
    monkeypatch.setattr(installer, "ROOT", tmp_path)
    monkeypatch.delenv("DATABASE_MAINTENANCE_URL", raising=False)
    env = tmp_path / "apps/api/.env"
    env.parent.mkdir(parents=True)
    env.write_text(
        "DATABASE_MAINTENANCE_URL=postgresql://postgres@127.0.0.1:5432/followw\n",
        encoding="utf-8",
    )
    source = tmp_path / ".local/cloudbeaver-source"
    for relative in (
        "server/product/web-server/target/products/io.cloudbeaver.product/all/all/all/plugins/org.jkiss.dbeaver.launcher_test.jar",
        "webapp/packages/product-default/lib/index.html",
        "config/core/logback.xml",
        "deploy/drivers/postgresql/postgresql.jar",
        "deploy/drivers/h2_v2/h2-legacy-2.jar",
        "deploy/drivers/unused/driver.jar",
    ):
        file = source / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('level="DEBUG"', encoding="utf-8")
    target = tmp_path / ".local/cloudbeaver"
    target.mkdir(parents=True)
    config = (
        "server: {\n"
        + "\n".join(
            f' {key}: "default",'
            for key in (
                "serverPort",
                "rootURI",
                "anonymousAccessEnabled",
                "supportsCustomConnections",
                "resourceManagerEnabled",
                "core.localization.language",
                "plugin.sql-editor.autoSave",
            )
        )
        + "\n}"
    )
    (target / "cloudbeaver.generated.conf").write_text(config, encoding="utf-8")
    db = Banco()
    monkeypatch.setattr(installer.psycopg, "connect", lambda *_: db)
    return target, db


def test_instalacao_gera_segredo_local_e_conexao_de_leitura(instalacao):
    target, db = instalacao
    installer.configure(Path("java.exe"))
    password = json.loads(
        (target / "connection.private.json").read_text(encoding="utf-8")
    )["password"]
    assert len(password) >= 40
    connection = json.loads(
        (target / "conf/initial-data-sources.conf").read_text(encoding="utf-8")
    )["connections"]["followw-local"]
    assert connection["read-only"] is True
    assert connection["configuration"]["properties"]["user"] == installer.ROLE
    assert connection["configuration"]["auth-properties"]["userPassword"] == password
    assert password not in connection["configuration"]["url"]
    assert (target / "drivers/postgresql/postgresql.jar").exists()
    assert (target / "drivers/h2_v2/h2-legacy-2.jar").exists()
    assert not (target / "drivers/unused").exists()
    commands = " ".join(str(command) for command, _ in db.commands)
    assert "GRANT SELECT ON TABLE" in commands
    assert "REVOKE INSERT, UPDATE, DELETE, TRUNCATE" in commands
    assert "CREATE POLICY cloudbeaver_catalog_read" in commands
    assert "CREATE DATABASE" not in commands
    assert "DROP " not in commands


def test_reinstalacao_preserva_senha_conta_e_configuracao(instalacao):
    target, db = instalacao
    installer.configure(Path("java.exe"))
    files = [
        target / name
        for name in (
            "connection.private.json",
            "conf/cloudbeaver.conf",
            "conf/initial-data-sources.conf",
            "workspace/GlobalConfiguration/.dbeaver/data-sources.json",
        )
    ]
    (target / "conf/cloudbeaver.conf").write_text(
        "configuracao do usuario", encoding="utf-8"
    )
    before = [file.read_bytes() for file in files]
    db.existing = True
    db.commands.clear()
    installer.configure(Path("java.exe"))
    assert [file.read_bytes() for file in files] == before
    assert not any("CREATE ROLE" in str(query) for query, _ in db.commands)


def test_papel_existente_sem_senha_privada_nao_e_redefinido(instalacao):
    _, db = instalacao
    db.existing = True
    with pytest.raises(SystemExit, match="senha nao sera substituida"):
        installer.configure(Path("java.exe"))


def test_run_instala_antes_de_iniciar_e_permite_optar_por_nao_instalar():
    script = (ROOT / "scripts/run.ps1").read_text(encoding="utf-8")
    assert "[switch]$SkipCloudBeaver" in script
    assert script.index("'scripts\\install-cloudbeaver.ps1'") < script.index(
        "Step 'Subindo a API e o front'"
    )
    setup = (ROOT / "scripts/install-cloudbeaver.ps1").read_text(encoding="utf-8")
    assert "--depth','1'" in setup
    assert "Yarn @('install')" in setup
    assert "Get-FileHash $archive -Algorithm SHA512" in setup
    assert "Remove-Item -LiteralPath $resolvedBuild -Recurse -Force" in setup


@pytest.mark.skipif(not shutil.which("powershell"), reason="inicializador Windows")
@pytest.mark.parametrize("existing", [True, False])
def test_inicializador_reaproveita_supervisor_ou_inicia_sem_reinstalar(existing):
    script = str(ROOT / "scripts/run.ps1").replace("'", "''")
    command = rf"""
    $ErrorActionPreference='Stop'
    $tokens=$null; $errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseFile('{script}',[ref]$tokens,[ref]$errors)
    $ast.FindAll({{param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-DatabaseManager'}},$true) | ForEach-Object {{Invoke-Expression $_.Extent.Text}}
    $Root='C:\projeto'; $created=0
    function Get-CimInstance {{ if (${str(existing).lower()}) {{[pscustomobject]@{{ProcessId=42;CommandLine='powershell -File "C:\projeto\scripts\cloudbeaver-service.ps1"'}}}} }}
    function Get-Process {{[pscustomobject]@{{Id=42}}}}
    function Start-Process {{$script:created++;[pscustomobject]@{{Id=43}}}}
    $manager=Start-DatabaseManager
    Write-Output "$($manager.Id):$created"
    """
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr.decode(errors="replace")
    assert result.stdout.strip() == (b"42:0" if existing else b"43:1")
