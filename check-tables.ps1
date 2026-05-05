# check-tables.ps1 — Verifica existencia de tablas en Supabase
# USO: $env:SUPABASE_URL="https://xxx.supabase.co"; $env:SUPABASE_ANON_KEY="eyJ..."; .\check-tables.ps1

$anonKey = $env:SUPABASE_ANON_KEY
$url     = $env:SUPABASE_URL + "/rest/v1/"

if (-not $anonKey -or -not $env:SUPABASE_URL) {
    Write-Host "ERROR: Define las variables de entorno antes de ejecutar:" -ForegroundColor Red
    Write-Host "  SUPABASE_URL       (ej: https://xxxxx.supabase.co)" -ForegroundColor Yellow
    Write-Host "  SUPABASE_ANON_KEY  (anon key del proyecto)" -ForegroundColor Yellow
    exit 1
}

$headers = @{
    'apikey'        = $anonKey
    'Authorization' = "Bearer $anonKey"
}

$tables = @('profiles','watchlist_items','positions','transactions','alerts','signals')

foreach ($t in $tables) {
    try {
        $resp = Invoke-RestMethod -Uri ($url + $t + '?limit=1') -Headers $headers
        Write-Output ($t + ' : EXISTS')
    } catch {
        Write-Output ($t + ' : MISSING')
    }
}

# bumped: 2026-05-05T04:21:00