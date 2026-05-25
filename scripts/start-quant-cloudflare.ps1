param(
  [switch]$UpdateVercel,
  [switch]$Deploy,
  [switch]$InstallStartupTask
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$quantDir = Join-Path $repoRoot "quant-engine"
$pythonExe = Join-Path $quantDir "venv\Scripts\python.exe"
$cloudflaredExe = Join-Path $repoRoot "cloudflared.exe"
$stderrLog = Join-Path $repoRoot "cloudflared-stderr.log"
$stdoutLog = Join-Path $repoRoot "cloudflared-stdout.log"
$envLocal = Join-Path $repoRoot ".env.local"

function Test-HttpOk($url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Set-EnvValue($path, $name, $value) {
  $line = "$name=$value"
  if (Test-Path $path) {
    $content = Get-Content $path
    if ($content -match "^$name=") {
      $content = $content | ForEach-Object { if ($_ -match "^$name=") { $line } else { $_ } }
    } else {
      $content += $line
    }
    Set-Content -Path $path -Value $content
  } else {
    Set-Content -Path $path -Value $line
  }
}

if (-not (Test-Path $pythonExe)) {
  throw "No existe $pythonExe. Crea el venv e instala quant-engine/requirements.txt."
}

if (-not (Test-Path $cloudflaredExe)) {
  throw "No existe $cloudflaredExe. Deja cloudflared.exe en la raiz del proyecto."
}

if (-not (Test-HttpOk "http://127.0.0.1:8000/health")) {
  Start-Process -FilePath $pythonExe -ArgumentList "run.py" -WorkingDirectory $quantDir -WindowStyle Hidden
  Start-Sleep -Seconds 5
}

if (-not (Test-HttpOk "http://127.0.0.1:8000/health")) {
  throw "El quant-engine no respondio en http://127.0.0.1:8000/health."
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stderrLog, $stdoutLog -Force -ErrorAction SilentlyContinue

Start-Process `
  -FilePath $cloudflaredExe `
  -ArgumentList @("tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate") `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden

$publicUrl = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $stderrLog) {
    $log = Get-Content $stderrLog -Raw
    $match = [regex]::Match($log, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($match.Success) {
      $publicUrl = $match.Value
      break
    }
  }
}

if (-not $publicUrl) {
  throw "Cloudflared no entrego URL publica. Revisa $stderrLog."
}

$publicHealthOk = $false
for ($i = 0; $i -lt 45; $i++) {
  if (Test-HttpOk "$publicUrl/health") {
    $publicHealthOk = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $publicHealthOk) {
  throw "El tunel fue creado ($publicUrl), pero /health no respondio a tiempo."
}

Set-EnvValue $envLocal "QUANT_ENGINE_URL" $publicUrl

Write-Host "Quant-engine local: http://127.0.0.1:8000"
Write-Host "Cloudflare tunnel: $publicUrl"
Write-Host ".env.local actualizado: QUANT_ENGINE_URL=$publicUrl"

if ($UpdateVercel) {
  Push-Location $repoRoot
  try {
    vercel env add QUANT_ENGINE_URL production --value $publicUrl --force --yes --scope cataldo89-1519s-projects
    if ($Deploy) {
      vercel deploy --prod --scope cataldo89-1519s-projects
    }
  } finally {
    Pop-Location
  }
}

if ($InstallStartupTask) {
  $startupDir = [Environment]::GetFolderPath("Startup")
  $startupFile = Join-Path $startupDir "TradeMind Quant Cloudflare.cmd"
  $startupContent = @(
    "@echo off",
    "cd /d `"$repoRoot`"",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -UpdateVercel -Deploy"
  )
  Set-Content -Path $startupFile -Value $startupContent
  Write-Host "Inicio automatico instalado: $startupFile"
}
