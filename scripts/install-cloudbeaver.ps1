<# Instala o CloudBeaver CE isolado em .local; execute com o Followw parado. #>
param([switch]$SkipBuild, [switch]$KeepBuild)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Local = Join-Path $Root '.local'
$Install = Join-Path $Local 'cloudbeaver'
$BuildRoot = Join-Path $Local 'cloudbeaver-build'
if (Get-NetTCPConnection -LocalPort 8978 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Pare o Followw antes de instalar ou atualizar o CloudBeaver.'
}
foreach ($command in @('git', 'uv', 'node', 'npm')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Instale $command antes de continuar (scripts/run.ps1 instala as ferramentas basicas)." }
}
function Checked($Command, $Arguments) {
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Falha em $Command (codigo $LASTEXITCODE)." }
}
function Source($Name, $Repo, $Commit) {
    $parent = if ($SkipBuild) { $Local } else { $BuildRoot }
    $path = Join-Path $parent $Name
    if (-not (Test-Path $path)) {
        if ($SkipBuild) { throw 'Artefatos ausentes. Execute sem -SkipBuild.' }
        New-Item -ItemType Directory -Force $path | Out-Null
        Checked git @('init',$path)
        Checked git @('-C',$path,'config','core.longpaths','true')
        Checked git @('-C',$path,'remote','add','origin',"https://github.com/dbeaver/$Repo.git")
        Checked git @('-C',$path,'-c','core.autocrlf=false','fetch','--depth','1','origin',$Commit)
        Checked git @('-C',$path,'-c','core.autocrlf=false','checkout','--detach','FETCH_HEAD')
    }
    Checked git @('-C',$path,'config','core.longpaths','true')
    $head = & git -C $path rev-parse HEAD
    if ($head.Trim() -ne $Commit) {
        if (& git -C $path status --porcelain) { throw "Clone local alterado: $path. Preserve as alteracoes antes de atualizar." }
        Checked git @('-C',$path,'fetch','--depth','1','origin',$Commit)
        Checked git @('-C',$path,'checkout','--detach',$Commit)
    }
    foreach ($missing in (& git -C $path ls-files --deleted)) {
        Checked git @('-C',$path,'restore','--worktree','--',$missing)
    }
    return $path
}
$source = Source 'cloudbeaver-source' 'cloudbeaver' '480bf79bc75fdbb7f5a5ac92d0bc6b0d52333afc'
# Dependencias estaveis correspondentes ao produto 26.2.0, nunca master.
$null = Source 'dbeaver' 'dbeaver' '4135af239c69dc86d6b8385118d96404bd2b0563'
$null = Source 'dbeaver-common' 'dbeaver-common' '16736922386bffc0a5386ea5cfde6d5288f0da21'
$javaRoot = if ($SkipBuild) { Join-Path $Local 'jdk25' } else { Join-Path $BuildRoot 'jdk25' }
$java = Get-ChildItem $javaRoot -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $java) {
    New-Item -ItemType Directory -Force $javaRoot | Out-Null
    $release = @(Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse')[0]
    $zip = Join-Path $javaRoot 'jdk.zip'
    Invoke-WebRequest -UseBasicParsing $release.binary.package.link -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $release.binary.package.checksum) { throw 'Checksum do JDK invalido.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $javaRoot -Force
    Remove-Item -LiteralPath $zip -Force
    $java = Get-ChildItem $javaRoot -Filter java.exe -Recurse | Select-Object -First 1
}
if (-not $java) { throw 'JDK 25 nao encontrado.' }
$env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java.FullName)
$env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path"
$maven = Get-Command mvn -ErrorAction SilentlyContinue
if (-not $maven) {
    $mavenVersion = '3.9.11'
    $mavenRoot = Join-Path $BuildRoot 'maven'
    New-Item -ItemType Directory -Force $mavenRoot | Out-Null
    $archive = Join-Path $mavenRoot 'maven.zip'
    $uri = "https://archive.apache.org/dist/maven/maven-3/$mavenVersion/binaries/apache-maven-$mavenVersion-bin.zip"
    $checksum = ((Invoke-WebRequest -UseBasicParsing "$uri.sha512").Content.Trim() -split '\s+')[0]
    Invoke-WebRequest -UseBasicParsing $uri -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA512).Hash -ne $checksum) { throw 'Checksum do Maven invalido.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $mavenRoot -Force
    Remove-Item -LiteralPath $archive -Force
    $env:Path = "$(Join-Path $mavenRoot "apache-maven-$mavenVersion\bin");$env:Path"
}
function Yarn($Arguments) {
    if (Get-Command corepack -ErrorAction SilentlyContinue) { Checked corepack (@('yarn') + $Arguments) }
    else { Checked npm (@('exec','--yes','--package=corepack@0.34.0','--','corepack','yarn') + $Arguments) }
}
if (-not $SkipBuild) {
    Checked uv @('run','--no-sync','python',(Join-Path $Root 'scripts/cloudbeaver/localize.py'),$source)
    Checked mvn @('-f',(Join-Path $source 'server/product/aggregate/pom.xml'),'verify','-Dheadless-platform','-DskipTests')
    Push-Location (Join-Path $source 'webapp')
    try {
        # O hash do pacote file:react-data-grid varia no Windows; as revisoes externas seguem fixadas no lock.
        Yarn @('install')
        Yarn @('workspace','@cloudbeaver/product-default','run','bundle')
    } finally { Pop-Location }
}
New-Item -ItemType Directory -Force (Join-Path $Install 'conf') | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $Install /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel restringir permissoes da instalacao privada.' }
$jre = Join-Path $Install 'jre'
if (-not (Test-Path $jre)) {
    $runtimeStage = Join-Path $BuildRoot 'java-runtime'
    if (Test-Path $runtimeStage) {
        if ((Resolve-Path -LiteralPath $runtimeStage).Path -ne (Join-Path (Resolve-Path -LiteralPath $BuildRoot).Path 'java-runtime')) { throw 'Runtime temporario fora da compilacao.' }
        Remove-Item -LiteralPath $runtimeStage -Recurse -Force
    }
    $modules = ((& $java.FullName --list-modules) | ForEach-Object { ($_ -split '@')[0] } | Where-Object { $_ -notin @('jdk.jlink','jdk.jpackage') }) -join ','
    if ($LASTEXITCODE -ne 0 -or -not $modules) { throw 'Nao foi possivel listar os modulos Java.' }
    Checked (Join-Path $env:JAVA_HOME 'bin\jlink.exe') @('--add-modules',$modules,'--strip-debug','--no-header-files','--no-man-pages','--compress','zip-6','--output',$runtimeStage)
    Move-Item -LiteralPath $runtimeStage -Destination $jre
}
if (-not (Test-Path (Join-Path $jre 'bin\java.exe'))) { throw 'Runtime Java incompleto. Preserve o workspace e revise somente a pasta jre.' }
$generated = Join-Path $Install 'cloudbeaver.generated.conf'
Checked mvn @('-f',(Join-Path $source 'apps/config-generator/pom.xml'),'compile','exec:java',"-Dconfig.output=$generated")
Push-Location $Root
try { Checked uv @('run','--no-sync','python','scripts/configure_cloudbeaver.py','--java',(Join-Path $jre 'bin\java.exe'),'--source',$source) }
finally { Pop-Location }
& icacls "$Install\*" /reset /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel aplicar heranca privada aos arquivos.' }
if (-not $KeepBuild -and (Test-Path $BuildRoot)) {
    $resolvedBuild = (Resolve-Path -LiteralPath $BuildRoot).Path
    if ($resolvedBuild -ne (Join-Path (Resolve-Path -LiteralPath $Local).Path 'cloudbeaver-build')) { throw 'Diretorio de compilacao inesperado.' }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
Write-Host 'Instalado. Inicie scripts/run.ps1 e abra Banco de dados no admin como Owner com MFA.'
