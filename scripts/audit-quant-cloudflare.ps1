param()

$ErrorActionPreference = "Continue"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$statusFile = Join-Path $repoRoot "quant-start-status.json"
$envLocal = Join-Path $repoRoot ".env.local"
$stderrLog = Join-Path $repoRoot "cloudflared-stderr.log"
$startupDir = [Environment]::GetFolderPath("Startup")
$startupFile = Join-Path $startupDir "TradeMind Quant Cloudflare.cmd"

function Write-Section($title) {
  Write-Host ""
  Write-Host "=== $title ==="
}

Write-Section "Startup"
Write-Host "Startup dir: $startupDir"
if (Test-Path $startupFile) {
  Get-Item $startupFile | Select-Object FullName, LastWriteTime | Format-List
  Write-Host "Contenido:"
  Get-Content $startupFile
} else {
  Write-Host "No existe inicio automatico TradeMind."
}

Write-Section "Procesos"
$processes = Get-CimInstance Win32_Process -Filter "name='python.exe' OR name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -match 'quant-engine|cloudflared|run.py' } |
  Select-Object ProcessId, Name, ParentProcessId, CreationDate, CommandLine
if ($processes) {
  $processes | Format-List
} else {
  Write-Host "No hay procesos quant/cloudflared activos."
}

Write-Section "Puerto 8000"
$listeners = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess
if ($listeners) {
  $listeners | Format-List
} else {
  Write-Host "Nadie escucha en 127.0.0.1:8000."
}

Write-Section "Health local"
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 5 | ConvertTo-Json -Compress
} catch {
  Write-Host "Falla local health: $($_.Exception.Message)"
}

Write-Section "URL publica"
$publicUrl = $null
if (Test-Path $envLocal) {
  $line = Get-Content $envLocal | Where-Object { $_ -match '^QUANT_ENGINE_URL=' } | Select-Object -First 1
  if ($line) {
    $publicUrl = $line -replace '^QUANT_ENGINE_URL=', ''
    Write-Host ".env.local QUANT_ENGINE_URL=$publicUrl"
  }
}

if (-not $publicUrl -and (Test-Path $stderrLog)) {
  $log = Get-Content $stderrLog -Raw
  $match = [regex]::Match($log, "https://[a-z0-9-]+\.trycloudflare\.com")
  if ($match.Success) {
    $publicUrl = $match.Value
    Write-Host "cloudflared log URL=$publicUrl"
  }
}

if ($publicUrl) {
  try {
    Invoke-RestMethod -Uri "$publicUrl/health" -TimeoutSec 10 | ConvertTo-Json -Compress
  } catch {
    Write-Host "Falla public health: $($_.Exception.Message)"
  }
} else {
  Write-Host "No se encontro QUANT_ENGINE_URL publica."
}

Write-Section "Ultimo estado START"
if (Test-Path $statusFile) {
  Get-Content $statusFile
} else {
  Write-Host "No existe quant-start-status.json. Ejecuta START_QUANT_CLOUDFLARE.cmd o npm run quant:start:vercel."
}

Write-Section "Errores recientes cloudflared"
if (Test-Path $stderrLog) {
  Select-String -Path $stderrLog -Pattern "ERR|error|Request failed|context canceled|trycloudflare" -CaseSensitive:$false |
    Select-Object -Last 30 |
    ForEach-Object { $_.Line }
} else {
  Write-Host "No existe cloudflared-stderr.log."
}
