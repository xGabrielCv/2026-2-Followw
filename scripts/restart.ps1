<#
.SYNOPSIS
    Reinicia o Followw com o código atual: para tudo e sobe de novo numa janela nova.

.EXAMPLE
    .\scripts\restart.ps1         # ou restart.cmd com duplo clique
    .\scripts\restart.ps1 -Offline
#>
$Root = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'stop.ps1')
Write-Host "==> Subindo de novo..." -ForegroundColor Cyan
# Entre aspas: o Start-Process separa os argumentos nos espaços do caminho.
$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $PSScriptRoot 'run.ps1')), '-NoBrowser') + $args
Start-Process powershell -WindowStyle Hidden -WorkingDirectory $Root -ArgumentList $arguments | Out-Null
Write-Host "    ok  o Followw abre numa janela nova em instantes" -ForegroundColor Green
