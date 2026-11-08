# Define o usuário e a senha do painel do administrador (grava só o hash em apps\api\.env).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location (Join-Path $Root 'apps\api')
try { uv run --no-sync --quiet admin-password @args } finally { Pop-Location }
