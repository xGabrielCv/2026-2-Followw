<#
.SYNOPSIS
    Verifica e instala as dependências do Followw e sobe tudo no localhost.

.DESCRIPTION
    Banco (PostgreSQL portátil em .local/), fila de jobs (no processo da API), API e front rodam
    no próprio PC, sem Docker e sem serviços em nuvem. Só o SIGAA/RU da UnB são consultados, e só
    quando você faz login ou abre seus dados; com -Offline nem isso.

.EXAMPLE
    .\scripts\run.ps1              # verifica, instala o que faltar e abre http://localhost:3000
    .\scripts\run.ps1 -Offline     # bloqueia qualquer acesso externo da API
    .\scripts\run.ps1 -Check       # só verifica as dependências, sem subir nada
    .\scripts\run.ps1 -Test        # verificação completa: lint, tipos e todos os testes (API e front)
    .\scripts\run.ps1 -Reseed      # recarrega os dados públicos (cursos, matérias, turmas)
    .\scripts\run.ps1 -Update      # atualiza agora os dados do SIGAA público (turmas, matérias, docentes)
    .\scripts\run.ps1 -CollectOffer 2027.1   # atualiza só as turmas de um semestre
    .\scripts\run.ps1 -Stop        # para o banco que ficou rodando
#>
[CmdletBinding()]
param(
    [switch]$Offline,
    [switch]$Check,
    [switch]$Test,
    [switch]$Reseed,
    [switch]$Update,
    [ValidatePattern('^\d{4}\.\d$')]
    [string]$CollectOffer,
    [switch]$Stop,
    [switch]$NoBrowser,
    [switch]$SkipDataUpdate,
    [switch]$Demo,
    [int]$WebPort = 3000,
    [int]$ApiPort = 8000,
    [int]$DbPort = 5432
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $PSScriptRoot
$Local = Join-Path $Root '.local'
$PgVersion = '18.4-1'
$PgHome = Join-Path $Local 'pgsql'
$PgBin = Join-Path $PgHome 'bin'
$PgData = Join-Path $Local 'pgdata'
$PgLog = Join-Path $Local 'postgres.log'
$ApiDir = Join-Path $Root 'apps\api'
$WebDir = Join-Path $Root 'apps\web'
$SeedMarker = Join-Path $Local 'seed.sha256'
$professorsCsv = Join-Path $Local 'data\professors.csv'
$professorsMarker = Join-Path $Local 'professors.sha256'
$UpdateState = Join-Path $Local 'update.json'
$UpdateLog = Join-Path $Local 'update.log'
# Os dados públicos do SIGAA se atualizam sozinhos, em segundo plano, a cada tantos dias.
$UpdateEveryDays = 3
$DatabaseUrl = "postgresql+asyncpg://postgres@127.0.0.1:$DbPort/followw"

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "    [ok] $message" -ForegroundColor Green }
function Warn($message) { Write-Host "    [!] $message" -ForegroundColor Yellow }
function Fail($message) { Write-Host "    [x] $message" -ForegroundColor Red; exit 1 }

# Programas instalados nesta mesma sessão só aparecem no PATH depois de recarregá-lo.
function Update-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Test-Command($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Install-WithWinget($id, $command) {
    if (Test-Command $command) { return }
    if ($Check) { Warn "$command ausente (instale com: winget install $id)"; return }
    if ($Offline) { Fail "$command ausente. Instale as dependências com internet antes de usar -Offline." }
    if (-not (Test-Command 'winget')) { Fail "$command ausente e o winget não está disponível. Instale $id manualmente." }
    Write-Host "    instalando $id..."
    winget install --id $id --exact --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Update-Path
    if (-not (Test-Command $command)) {
        # Alguns pacotes só aceitam instalação para a máquina toda.
        winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null
        Update-Path
    }
    if (-not (Test-Command $command)) { Fail "Não foi possível instalar $id. Abra um novo terminal e rode de novo." }
}

function Test-Port($port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $client.Dispose() }
}

function Wait-Port($port, $seconds, $what) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $port) { return }
        Start-Sleep -Milliseconds 500
    }
    Fail "$what não respondeu na porta $port em ${seconds}s."
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $Root)
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) { Fail "$FilePath $($Arguments -join ' ') falhou (código $LASTEXITCODE)." }
    } finally { Pop-Location }
}

function Stop-Database {
    if (Test-Path (Join-Path $PgData 'postmaster.pid')) {
        & (Join-Path $PgBin 'pg_ctl.exe') -D $PgData stop -m fast | Out-Null
    }
}

if ($Stop) { Stop-Database; Ok 'Banco parado.'; exit 0 }

New-Item -ItemType Directory -Force $Local | Out-Null
Update-Path

# Uma segunda execução não reinstala dependências nem abre outra aba da instância ativa.
if (-not ($Check -or $Test -or $Reseed -or $Update -or $CollectOffer) -and (Test-Port $WebPort) -and (Test-Port $ApiPort)) {
    Ok "Instância já em execução: http://localhost:$WebPort"
    exit 0
}

# ---------------------------------------------------------------- ferramentas
Step 'Ferramentas'
Install-WithWinget 'Git.Git' 'git'
Install-WithWinget 'astral-sh.uv' 'uv'
Install-WithWinget 'OpenJS.NodeJS.LTS' 'node'
Install-WithWinget 'Oven-sh.Bun' 'bun'
foreach ($tool in 'git', 'uv', 'node', 'bun') {
    if (Test-Command $tool) { Ok "$tool $((& $tool --version 2>$null | Select-Object -First 1))" }
}

# O uv baixa o Python exigido pelo projeto (>=3.14) se ele não existir.
if (-not $Check) {
    if (-not $Offline) { Invoke-Checked uv @('python', 'install', '3.14', '--quiet') }
}
Ok 'Python 3.14 (gerenciado pelo uv)'

# ------------------------------------------------------------ PostgreSQL local
Step 'PostgreSQL portátil'
if (-not (Test-Path (Join-Path $PgBin 'pg_ctl.exe'))) {
    if ($Check) { Warn "PostgreSQL ausente em $PgHome" }
    else {
        if ($Offline) { Fail 'PostgreSQL ausente. Execute uma vez com internet antes de usar -Offline.' }
        $zip = Join-Path $Local "downloads\postgresql-$PgVersion-windows-x64-binaries.zip"
        if (-not (Test-Path $zip)) {
            New-Item -ItemType Directory -Force (Split-Path $zip) | Out-Null
            Write-Host "    baixando PostgreSQL $PgVersion (~330 MB, só na primeira vez)..."
            Invoke-WebRequest -UseBasicParsing -OutFile "$zip.part" `
                -Uri "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-windows-x64-binaries.zip"
            Move-Item "$zip.part" $zip
        }
        Write-Host '    extraindo...'
        # O tar do Windows é bem mais rápido que o Expand-Archive; pgAdmin e símbolos não são usados.
        $skip = 'pgAdmin 4', 'symbols', 'doc', 'include', 'StackBuilder' | ForEach-Object { '--exclude', "pgsql/$_" }
        tar -xf $zip -C $Local @skip
        if ($LASTEXITCODE -ne 0) { Fail 'Falha ao extrair o PostgreSQL.' }
        # O zip (~330 MB) não serve mais depois de extraído.
        Remove-Item -LiteralPath $zip -Force
    }
}
if (Test-Path (Join-Path $PgBin 'pg_ctl.exe')) {
    Ok ((& (Join-Path $PgBin 'postgres.exe') --version) -join '')
}

if (-not $Check) {
    if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
        Write-Host '    criando o cluster em .local\pgdata...'
        Invoke-Checked (Join-Path $PgBin 'initdb.exe') @(
            '-D', $PgData, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8',
            '--locale-provider=builtin', '--builtin-locale=C.UTF-8'
        ) | Out-Null
    }
    $startedDb = $false
    if (-not (Test-Port $DbPort)) {
        $startedDb = $true
        # Só aceita conexões do próprio PC. Sem pipe: o postgres herdaria a saída
        # e o PowerShell esperaria ele terminar.
        $start = New-Object Diagnostics.ProcessStartInfo (Join-Path $PgBin 'pg_ctl.exe')
        $start.Arguments = "-D `"$PgData`" -l `"$PgLog`" -w -o `"-p $DbPort -c listen_addresses=127.0.0.1`" start"
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $pgCtl = [Diagnostics.Process]::Start($start)
        $pgCtl.WaitForExit()
        if ($pgCtl.ExitCode -ne 0) { Fail "O PostgreSQL não subiu; veja $PgLog" }
    }
    $exists = & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $DbPort -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='followw'"
    if ($LASTEXITCODE -ne 0) { Fail "A porta $DbPort está ocupada por outro programa. Use -DbPort." }
    if ($exists -ne '1') {
        Invoke-Checked (Join-Path $PgBin 'createdb.exe') @('-h', '127.0.0.1', '-p', $DbPort, '-U', 'postgres', 'followw')
    }
    # O log de transações (WAL) chega a 1 GB por padrão; para um banco local, 64 MB sobram.
    & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $DbPort -U postgres -d followw -q `
        -c "ALTER SYSTEM SET max_wal_size = '64MB'" -c "ALTER SYSTEM SET min_wal_size = '32MB'" `
        -c 'SELECT pg_reload_conf()' -c 'CHECKPOINT' | Out-Null
    Ok "banco followw em 127.0.0.1:$DbPort"
}

# ------------------------------------------------------------- dependências
Step 'Dependências do projeto'
if ($Check) {
    if (Test-Path (Join-Path $Root '.venv')) { Ok 'ambiente Python (.venv)' } else { Warn '.venv ausente' }
    if (Test-Path (Join-Path $WebDir 'node_modules')) { Ok 'node_modules do front' } else { Warn 'node_modules ausente' }
    exit 0
}
$syncArgs = @('sync', '--all-packages', '--all-groups', '--locked', '--quiet')
if ($Offline) { $syncArgs += '--offline' }
Invoke-Checked uv $syncArgs
Ok 'Python (uv sync)'
if (-not $Offline) { Invoke-Checked bun @('install', '--frozen-lockfile', '--silent') $WebDir }
elseif (-not (Test-Path (Join-Path $WebDir 'node_modules'))) { Fail 'Instale as dependências uma vez com internet antes de usar -Offline.' }
Ok 'front (bun install)'

# ------------------------------------------------------------- atualização
# O scripts/update_data.py lê o SIGAA público (sem login), troca só o que mudou nos CSVs e no banco.
function Test-UpdateDue {
    if (-not (Test-Path $UpdateState)) { return $true }
    try { $last = [datetime]::Parse((Get-Content $UpdateState -Raw | ConvertFrom-Json).updated_at) }
    catch { return $true }
    return ((Get-Date) - $last).TotalDays -ge $UpdateEveryDays
}
if ($Update -or $CollectOffer) {
    Step 'Atualizando os dados do SIGAA público'
    $env:DATABASE_URL = $DatabaseUrl
    $env:JOB_QUEUE = 'local'
    $env:PYTHONUTF8 = '1'
    $updateArgs = @('run', '--no-sync', 'python', 'scripts/update_data.py')
    if ($CollectOffer) { $updateArgs += @('--offer', $CollectOffer) }
    Invoke-Checked uv $updateArgs
    Ok 'dados atualizados'
    exit 0
}

# ------------------------------------------------------------- verificação
if ($Test) {
    Step 'Verificação completa'
    if (-not $Offline) { Invoke-Checked uv @('run', '--no-sync', 'python', 'scripts/bootstrap_data.py') }
    $exists = & (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -p $DbPort -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='followw_test'"
    if ($exists -ne '1') {
        Invoke-Checked (Join-Path $PgBin 'createdb.exe') @('-h', '127.0.0.1', '-p', $DbPort, '-U', 'postgres', 'followw_test')
    }
    # Os testes da API usam este Postgres no lugar do container do testcontainers.
    $env:TEST_POSTGRES_URL = "postgresql+psycopg://postgres@127.0.0.1:$DbPort/followw_test"
    $failed = @()
    Push-Location $Root
    uv run --no-sync ruff check .; if ($LASTEXITCODE) { $failed += 'ruff check' }
    uv run --no-sync ruff format --check .; if ($LASTEXITCODE) { $failed += 'ruff format' }
    uv run --no-sync pytest -q -p no:cacheprovider; if ($LASTEXITCODE) { $failed += 'pytest' }
    Pop-Location
    Push-Location $WebDir
    bun run check; if ($LASTEXITCODE) { $failed += 'oxfmt/oxlint/tsc' }
    bun test; if ($LASTEXITCODE) { $failed += 'bun test' }
    Pop-Location
    if ($startedDb) { Stop-Database }
    if ($failed) { Fail "Falhou: $($failed -join ', ')" }
    Ok 'Tudo verde.'
    exit 0
}

# -------------------------------------------------------------- configuração
$envFile = Join-Path $ApiDir '.env'
if (-not (Test-Path $envFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = [Convert]::ToBase64String($bytes)
    @(
        '# Gerado pelo run.ps1 para rodar tudo localmente.'
        'ENVIRONMENT=development'
        "JWT_SECRET_KEY=$secret"
        '# Credenciais opcionais para testar a área autenticada'
        'TEST_REGISTRATION='
        'TEST_PASSWORD='
    ) | Set-Content -Encoding ascii $envFile
    Ok 'apps\api\.env criado com um segredo novo'
}
# Cifra em repouso do conteúdo da comunidade e dos arquivos: uma chave só deste computador.
if (-not (Select-String -Path $envFile -Pattern '^DATA_ENCRYPTION_KEY=.+' -Quiet)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $dataKey = [Convert]::ToBase64String($bytes)
    Add-Content -Encoding ascii $envFile @('# Chave que cifra o conteudo da comunidade no banco e os arquivos (guarde com cuidado)', "DATA_ENCRYPTION_KEY=$dataKey")
    Ok 'chave de cifra dos dados criada em apps\api\.env'
}
# A API conecta ao PostgreSQL com o papel restrito `followw_app` (sem bypass de Row-Level Security);
# o db-init e as cargas usam a conta de manutenção. A senha do papel é só deste computador.
if (-not (Select-String -Path $envFile -Pattern '^APP_DB_PASSWORD=.+' -Quiet)) {
    $bytes = New-Object byte[] 24
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $appPassword = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
    Add-Content -Encoding ascii $envFile @('# Senha do papel restrito da API no PostgreSQL (guarde com cuidado)', "APP_DB_PASSWORD=$appPassword")
    Ok 'senha do papel restrito da API criada em apps\api\.env'
}
# O painel do administrador (/api/admin) pede usuário e senha; só o hash da senha fica no .env.
$adminReady = Select-String -Path $envFile -Pattern '^ADMIN_PASSWORD_HASH=.+' -Quiet
if (-not $adminReady) {
    Write-Host "    Primeiro acesso do administrador: http://localhost:$WebPort/api/admin (crie seu usuário e senha na página)." -ForegroundColor Yellow
}

# Variáveis do processo têm prioridade sobre o .env: o modo local vale sempre por aqui.
$env:DATABASE_URL = $DatabaseUrl
$env:DATABASE_MAINTENANCE_URL = $DatabaseUrl
$env:JOB_QUEUE = 'local'
# Libera em Perfil > Conta os dados de demonstração; nunca fica ligado em produção.
$env:DEMO_DATA = if ($Demo) { '1' } else { '0' }
$env:PUBLIC_URL = "http://127.0.0.1:$ApiPort"
# O proxy /api do front (vite.config.ts) segue a porta da API.
$env:API_PORT = "$ApiPort"
$env:UPSTASH_REDIS_REST_URL = ''
$env:UPSTASH_REDIS_REST_TOKEN = ''
$env:VITE_POSTHOG_KEY = ''
$env:PYTHONUTF8 = '1'
if ($Offline) {
    # Um proxy inexistente: o httpx da API não alcança nada fora do PC.
    $env:HTTP_PROXY = 'http://127.0.0.1:9'
    $env:HTTPS_PROXY = 'http://127.0.0.1:9'
    $env:NO_PROXY = '127.0.0.1,localhost'
}

# ----------------------------------------------------------------- dados
Step 'Dados públicos'
$dataDir = Join-Path $Root 'packages\sigaa-client\data'
if (-not $Offline) {
    Invoke-Checked uv @('run', '--no-sync', 'python', 'scripts/bootstrap_data.py')
}
if (-not (Test-Path (Join-Path $dataDir 'units.csv'))) { Fail 'Catálogo ausente. Execute uma vez com internet para importar os dados públicos de referência.' }
# Os modelos entram no hash: tabela nova no código também roda o db-init, que só cria o que falta.
$hash = (@(Get-ChildItem $dataDir -Filter *.csv | Sort-Object Name) + @(Get-Item (Join-Path $ApiDir 'api\db\models.py'), (Join-Path $ApiDir 'api\db\security.py'), (Join-Path $ApiDir 'api\modules\support\models.py')) |
    Get-FileHash -Algorithm SHA256 | ForEach-Object Hash) -join ''
$seeded = if (Test-Path $SeedMarker) { Get-Content $SeedMarker -Raw } else { '' }
if ($Reseed -or $seeded.Trim() -ne $hash) {
    Write-Host '    criando tabelas e carregando unidades, cursos, currículos, matérias e turmas...'
    Invoke-Checked uv @('run', '--no-sync', '--quiet', 'db-init') $ApiDir
    Set-Content -Encoding ascii $SeedMarker $hash
    Ok 'dados carregados'
} else {
    Ok 'dados já carregados (use -Reseed para recarregar)'
}

# Catálogo de docentes do SIGAA público, coletado pela atualização (fora do git).
if (Test-Path $professorsCsv) {
    $professorsHash = (Get-FileHash $professorsCsv -Algorithm SHA256).Hash
    $professorsSeeded = if (Test-Path $professorsMarker) { (Get-Content $professorsMarker -Raw).Trim() } else { '' }
    if ($Reseed -or $professorsSeeded -ne $professorsHash) {
        Invoke-Checked uv @('run', '--no-sync', '--quiet', 'db-seed-professors', $professorsCsv) $ApiDir
        Set-Content -Encoding ascii $professorsMarker $professorsHash
        Ok 'catálogo de docentes carregado'
    } else {
        Ok 'catálogo de docentes já carregado'
    }
} else {
    Warn 'sem catálogo de docentes: a busca de docentes fica vazia (rode .\scripts\run.ps1 -Update)'
}

# ---------------------------------------------------------------- servidores
foreach ($port in $ApiPort, $WebPort) {
    if (Test-Port $port) { Fail "A porta $port já está em uso. Feche o programa que a usa ou rode com outra porta." }
}

if (-not $Offline -and -not $SkipDataUpdate -and (Test-UpdateDue)) {
    # Em outra janela minimizada: demora (os docentes levam ~1 h) e não segura o app.
    Start-Process powershell -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-Command',
        "Set-Location '$Root'; uv run --no-sync python scripts/update_data.py *> '$UpdateLog'"
    ) | Out-Null
    Warn "dados com mais de $UpdateEveryDays dias: atualizando em segundo plano (log em .local\update.log)"
}

# A partir daqui só a API roda, com o papel restrito: as políticas RLS passam a valer.
$appPasswordLine = Select-String -Path $envFile -Pattern '^APP_DB_PASSWORD=(.+)$' | Select-Object -First 1
if ($appPasswordLine) {
    $env:DATABASE_URL = "postgresql+asyncpg://followw_app:$($appPasswordLine.Matches[0].Groups[1].Value.Trim())@127.0.0.1:$DbPort/followw"
}
Step 'Subindo a API e o front'
$api = $null
$web = $null
try {
    $api = Start-Process -FilePath 'uv' -WorkingDirectory $ApiDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Local 'api.out.log') -RedirectStandardError (Join-Path $Local 'api.err.log') -ArgumentList @(
        'run', '--no-sync', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', $ApiPort,
        # O front recarrega sozinho; a API também, para nunca rodar código antigo.
        '--reload', '--reload-dir', 'api', '--reload-dir', '..\..\packages'
    )
    Wait-Port $ApiPort 90 'A API'
    Ok "API em http://127.0.0.1:$ApiPort/docs"

    if ($Offline) { Warn 'modo offline: login e dados do SIGAA/RU ficam indisponíveis' }
    $web = Start-Process -FilePath 'bun' -WorkingDirectory $WebDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Local 'web.out.log') -RedirectStandardError (Join-Path $Local 'web.err.log') -ArgumentList @('run', 'dev', '--host', '127.0.0.1', '--port', $WebPort, '--strictPort')
    Wait-Port $WebPort 120 'O front'
    # Uma única abertura depois de subir. Recarregar código ou atualizar dados não abre abas.
    if (-not $NoBrowser) { Start-Process "http://localhost:$WebPort" }
    Write-Host "`n    Followw em http://localhost:$WebPort  (Ctrl+C, .\scripts\stop.ps1 para parar ou .\scripts\restart.ps1 para reiniciar)" -ForegroundColor Green
    if ($adminReady) {
        Write-Host "    Painel do administrador: http://localhost:$WebPort/api/admin (usuario e senha do .\scripts\admin-password.cmd)`n" -ForegroundColor DarkGray
    } else {
        Write-Host "    Cadastre o administrador em http://localhost:$WebPort/api/admin`n" -ForegroundColor DarkGray
    }
    while (-not $web.HasExited -and -not $api.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    Step 'Encerrando'
    if ($web -and -not $web.HasExited) { taskkill /PID $web.Id /T /F | Out-Null }
    if ($api -and -not $api.HasExited) {
        # Derruba a árvore inteira: o uv deixa o Python como processo filho.
        taskkill /PID $api.Id /T /F | Out-Null
    }
    if ($startedDb) { Stop-Database; Ok 'API e banco parados.' } else { Ok 'API parada (o banco já estava rodando antes).' }
}
