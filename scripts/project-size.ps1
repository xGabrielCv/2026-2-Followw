<# Mede toda a pasta; -Clean remove somente caches reproduziveis, com o app parado. #>
[CmdletBinding()]
param([switch]$Clean, [switch]$Compress, [long]$LimitBytes = 1000000000)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if ($Clean -or $Compress) {
    foreach ($port in @(3000,8000,8978)) {
        foreach ($listener in Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            $processId = $listener.OwningProcess
            for ($depth=0; $depth -lt 8 -and $processId -gt 0; $depth++) {
                $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
                if (-not $process) { break }
                if (($process.ExecutablePath -and $process.ExecutablePath.StartsWith($Root+'\', [StringComparison]::OrdinalIgnoreCase)) -or ($process.CommandLine -and $process.CommandLine.Contains($Root))) { throw 'Pare o Followw antes de limpar ou comprimir as dependencias.' }
                $processId = $process.ParentProcessId
            }
        }
    }
}
if ($Clean) {
    foreach ($relative in @('.pytest_cache','.ruff_cache','apps/web/.output','apps/web/.nitro','apps/web/.tanstack','apps/web/dist','apps/web/node_modules/.vite','apps/web/node_modules/.nitro','apps/web/playwright-report','apps/web/test-results')) {
        $target = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $resolved = (Resolve-Path -LiteralPath $target).Path
        if (-not $resolved.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho fora do projeto.' }
        if ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cache e um link; limpeza recusada.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
    foreach ($relative in @('.venv','apps/api','packages','scripts')) {
        $base = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $base)) { continue }
        Get-ChildItem -LiteralPath $base -Directory -Recurse -Filter __pycache__ | ForEach-Object {
            $resolved = (Resolve-Path -LiteralPath $_.FullName).Path
            if (-not $resolved.StartsWith($Root+'\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cache Python fora do projeto.' }
            if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cache Python e um link.' }
            Remove-Item -LiteralPath $resolved -Recurse -ErrorAction Stop
        }
    }
}
if ($Compress) {
    foreach ($relative in @('.venv','apps/web/node_modules','.local/pgsql','.local/cloudbeaver/server','.local/cloudbeaver/web','.local/cloudbeaver/jre','.local/cloudbeaver/jre-complete')) {
        $target = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $resolved = (Resolve-Path -LiteralPath $target).Path
        if (-not $resolved.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Dependencia fora do projeto.' }
        & compact.exe /C "/S:$resolved" /I /Q
        if ($LASTEXITCODE -ne 0) { Write-Warning "Compressao incompleta: $relative" }
    }
}
if (-not ('FollowwDiskSize' -as [type])) {
    Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class FollowwDiskSize {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern uint GetCompressedFileSizeW(string path, out uint high);
    public static long Bytes(string path) {
        uint high;
        uint low = GetCompressedFileSizeW(path, out high);
        if (low == uint.MaxValue && Marshal.GetLastWin32Error() != 0) throw new Win32Exception();
        return (long)(((ulong)high << 32) | low);
    }
}
'@
}
$totals = @{}
$diskBytes = 0L
$pending = New-Object 'Collections.Generic.Stack[string]'
$pending.Push($Root)
while ($pending.Count) {
    foreach ($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($entry.PSIsContainer) { $pending.Push($entry.FullName); continue }
        $group = $entry.FullName.Substring($Root.Length + 1).Split([IO.Path]::DirectorySeparatorChar)[0]
        $totals[$group] += $entry.Length
        $diskBytes += [FollowwDiskSize]::Bytes($entry.FullName)
    }
}
$total = [long](($totals.Values | Measure-Object -Sum).Sum)
$totals.GetEnumerator() | Sort-Object Value -Descending | ForEach-Object { Write-Host ('{0,-22} {1,10:N1} MB' -f $_.Key, ($_.Value / 1000000)) }
Write-Host ('Total: {0:N3} GB ({1} bytes); meta: {2:N3} GB.' -f ($total / 1000000000), $total, ($LimitBytes / 1000000000))
Write-Host ('Armazenamento dos arquivos no disco: {0:N3} GB ({1} bytes), conforme GetCompressedFileSizeW; exclui metadados do sistema de arquivos.' -f ($diskBytes / 1000000000), $diskBytes)
if ($diskBytes -ge $LimitBytes) { Write-Warning 'Acima da meta no disco. Revise caches e artefatos; preserve dados, chaves, backups atuais e dependencias necessarias.' }
