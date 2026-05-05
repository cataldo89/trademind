param()
$ErrorActionPreference = "Stop"

# Configura estas variables en tu entorno o en un archivo .env.local (NO las hardcodees)
$serviceKey = $env:SUPABASE_SERVICE_ROLE_KEY
$projectRef = $env:SUPABASE_PROJECT_REF
$mgmtToken  = $env:SUPABASE_ACCESS_TOKEN

if (-not $serviceKey -or -not $projectRef -or -not $mgmtToken) {
    Write-Host "ERROR: Define las variables de entorno antes de ejecutar:" -ForegroundColor Red
    Write-Host "  SUPABASE_SERVICE_ROLE_KEY" -ForegroundColor Yellow
    Write-Host "  SUPABASE_PROJECT_REF" -ForegroundColor Yellow
    Write-Host "  SUPABASE_ACCESS_TOKEN" -ForegroundColor Yellow
    exit 1
}

$supabaseUrl = "https://" + $projectRef + ".supabase.co"

Write-Host "TradeMind Schema Applier" -ForegroundColor Cyan

# Construir SQL como string literal
$sql = Get-Content -Path (Join-Path $PSScriptRoot "supabase\schema.sql") -Raw -Encoding UTF8

Write-Host ("SQL length: " + $sql.Length + " chars")

# Intentar via Management API
$mgmtUrl = "https://api.supabase.com/v1/projects/" + $projectRef + "/database/query"

$bodyObj = [PSCustomObject]@{ query = $sql }
$bodyJson = $bodyObj | ConvertTo-Json -Depth 5 -Compress

Write-Host "Calling Management API..."

try {
    $resp = Invoke-WebRequest `
        -Uri $mgmtUrl `
        -Method POST `
        -Headers @{ Authorization = ("Bearer " + $mgmtToken); "Content-Type" = "application/json" } `
        -Body $bodyJson `
        -UseBasicParsing
    Write-Host ("Status: " + $resp.StatusCode) -ForegroundColor Green
    Write-Host $resp.Content
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host ("Error " + $statusCode + ": " + $_.Exception.Message) -ForegroundColor Red

    Write-Host ""
    Write-Host "ACCION REQUERIDA: Ejecuta el schema manualmente" -ForegroundColor Magenta
    Write-Host ("URL: https://supabase.com/dashboard/project/" + $projectRef + "/sql/new")
}

# bumped: 2026-05-05T04:21:00