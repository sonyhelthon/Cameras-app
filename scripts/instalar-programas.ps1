# Baixa o ffmpeg e o rclone para C:\cameras\bin (se ainda não existirem).
# Uso: powershell -ExecutionPolicy Bypass -File scripts\instalar-programas.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # deixa o download muito mais rápido
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$bin = 'C:\cameras\bin'
New-Item -ItemType Directory -Force $bin | Out-Null

function Instalar($nome, $url) {
    $destino = Join-Path $bin "$nome.exe"
    if (Test-Path $destino) { Write-Host "$nome ja instalado em $destino"; return }
    Write-Host "Baixando $nome... (pode levar alguns minutos)"
    $zip = Join-Path $env:TEMP "$nome-download.zip"
    $pasta = Join-Path $env:TEMP "$nome-download"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (Test-Path $pasta) { Remove-Item $pasta -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $pasta -Force
    $exe = Get-ChildItem $pasta -Recurse -Filter "$nome.exe" | Select-Object -First 1
    if (-not $exe) { throw "Nao encontrei $nome.exe dentro do arquivo baixado." }
    Copy-Item $exe.FullName $destino -Force
    Remove-Item $zip, $pasta -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "$nome instalado em $destino"
}

Instalar 'ffmpeg' 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
Instalar 'rclone' 'https://downloads.rclone.org/rclone-current-windows-amd64.zip'
Write-Host 'Pronto!'
