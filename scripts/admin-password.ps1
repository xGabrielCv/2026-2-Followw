# Configura o Owner; --recover PSEUDONIMO redefine seus fatores com confirmação local.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location (Join-Path $Root 'apps\api')
try { uv run --no-sync --quiet admin-password @args } finally { Pop-Location }
