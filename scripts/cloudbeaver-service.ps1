param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Install = Join-Path $Root '.local\cloudbeaver'
$runtime = Get-Content -Raw -LiteralPath (Join-Path $Install 'runtime.json') | ConvertFrom-Json
$identity = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Root)).Replace('/','_').Replace('\','_')
$mutex = New-Object Threading.Mutex($false, "Local\FollowwCloudBeaver_$identity")
if (-not $mutex.WaitOne(0)) { exit 0 }
$child = $null
try {
    # Depois de uma queda do supervisor, encerra somente o Java desta instalacao.
    $previousId = 0
    $pidFile = Join-Path $Install 'java.pid'
    if ((Test-Path $pidFile) -and [int]::TryParse((Get-Content -Raw $pidFile).Trim(), [ref]$previousId)) {
        $previous = Get-CimInstance Win32_Process -Filter "ProcessId=$previousId" -ErrorAction SilentlyContinue
        if ($previous -and $previous.Name -eq 'java.exe' -and $previous.CommandLine.Contains($runtime.launcher)) {
            Stop-Process -Id $previousId -Force
        }
    }
    while ($true) {
        $arguments = @('-Xmx1024m','-Dfile.encoding=UTF-8','--enable-native-access=ALL-UNNAMED','--add-modules=ALL-DEFAULT')
        foreach ($package in @('java.base/java.io','java.base/java.lang','java.base/java.lang.reflect','java.base/java.net','java.base/java.nio','java.base/java.nio.charset','java.base/java.text','java.base/java.time','java.base/java.util','java.base/java.util.concurrent','java.base/java.util.concurrent.atomic','java.base/jdk.internal.vm','java.base/jdk.internal.misc','java.base/sun.nio.ch','java.base/sun.security.ssl','java.base/sun.security.util','java.security.jgss/sun.security.jgss','java.security.jgss/sun.security.krb5','java.sql/java.sql')) {
            $arguments += "--add-opens=$package=ALL-UNNAMED"
        }
        $arguments += @('-jar',('"{0}"' -f $runtime.launcher),'-product','io.cloudbeaver.product.ce.product','-data','workspace','-web-config','conf/cloudbeaver.conf','-nl','pt_BR','-registryMultiLanguage')
        $child = Start-Process -FilePath $runtime.java -WorkingDirectory $Install -WindowStyle Hidden -PassThru -ArgumentList $arguments -RedirectStandardOutput (Join-Path $Install 'service.out.log') -RedirectStandardError (Join-Path $Install 'service.err.log')
        Set-Content -LiteralPath (Join-Path $Install 'java.pid') -Value $child.Id
        $failures=0
        $started=Get-Date
        while (-not $child.HasExited) {
            Start-Sleep -Seconds 5
            if (((Get-Date)-$started).TotalSeconds -lt 90) { continue }
            try {
                $null=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8978/api/admin/database/' -TimeoutSec 5
                $failures=0
            } catch { $failures++ }
            if ($failures -ge 3) {
                Stop-Process -Id $child.Id -Force
                break
            }
        }
        Add-Content -LiteralPath (Join-Path $Install 'supervisor.log') -Value ('{0:o} reiniciando servico' -f (Get-Date))
        Start-Sleep -Seconds 5
    }
} finally {
    if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -Force }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
