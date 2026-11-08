<#
.SYNOPSIS
    Para o Followw por completo: front, API, atualização em segundo plano e o PostgreSQL local.

.EXAMPLE
    .\stop.ps1            # ou stop.cmd com duplo clique
#>
param(
    [int]$WebPort = 3000,
    [int]$ApiPort = 8000
)

$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
$PgBin = Join-Path $Root '.local\pgsql\bin'
$PgData = Join-Path $Root '.local\pgdata'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    ok  $text" -ForegroundColor Green }

Step 'Parando o Followw'
$stopped = 0
# Quem escuta nas portas do app: o servidor do front e a API (com os processos filhos).
foreach ($port in $WebPort, $ApiPort) {
    $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($id in $owners) {
        if ($id -gt 0) { taskkill /PID $id /T /F 2>$null | Out-Null; $stopped++ }
    }
}
# O que sobrar deste projeto: recarregador da API, bun, a atualização dos dados.
$escaped = [Regex]::Escape($Root)
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -match $escaped -and
        $_.CommandLine -match 'uvicorn|update_data\.py|vite|bun(\.exe)?"? (run )?dev|run\.ps1' -and
        $_.CommandLine -notmatch 'stop\.ps1|restart\.ps1'
    } |
    ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null | Out-Null; $stopped++ }
Ok "processos do app encerrados ($stopped)"

if (Test-Path (Join-Path $PgData 'postmaster.pid')) {
    & (Join-Path $PgBin 'pg_ctl.exe') -D $PgData stop -m fast 2>$null | Out-Null
    Ok 'banco de dados parado'
} else {
    Ok 'banco de dados já estava parado'
}
Write-Host "`n    Followw parado. Para subir de novo: .\run.ps1 (ou .\restart.ps1)`n" -ForegroundColor Green
