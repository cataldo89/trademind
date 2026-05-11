$projectId = "agtgecjoobuilgabwrbo"
Write-Host "Generando tipos de Supabase para el proyecto $projectId..."
.\supabase.exe gen types typescript --project-id $projectId > src/types/supabase.ts
if ($LASTEXITCODE -eq 0) {
    Write-Host "Tipos de Supabase generados exitosamente en src/types/supabase.ts" -ForegroundColor Green
} else {
    Write-Host "Error al generar tipos. Asegúrate de haber ejecutado '.\supabase.exe login'." -ForegroundColor Red
}
