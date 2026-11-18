<#
.SYNOPSIS
    Reinicia o Followw com o código atual: para tudo e sobe de novo numa janela nova.

.EXAMPLE
    .\scripts\restart.ps1         # ou restart.cmd com duplo clique
    .\scripts\restart.ps1 -Offline
#>
$Root = Split-Path -Parent $PSScriptRoot
$stopParams = @{}
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq '-WebPort' -and ($i + 1) -lt $args.Count) { $stopParams['WebPort'] = [int]$args[$i + 1] }
    if ($args[$i] -eq '-ApiPort' -and ($i + 1) -lt $args.Count) { $stopParams['ApiPort'] = [int]$args[$i + 1] }
}
& (Join-Path $PSScriptRoot 'stop.ps1') @stopParams
Write-Host "==> Subindo de novo..." -ForegroundColor Cyan
# Entre aspas: o Start-Process separa os argumentos nos espaços do caminho.
$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $PSScriptRoot 'run.ps1')), '-NoBrowser') + $args
Start-Process powershell -WindowStyle Hidden -WorkingDirectory $Root -ArgumentList $arguments | Out-Null
Write-Host "    ok  o Followw está subindo em segundo plano em instantes" -ForegroundColor Green
