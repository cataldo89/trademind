$ErrorActionPreference = "SilentlyContinue"

Get-Process cloudflared | Stop-Process -Force

$listeners = Get-NetTCPConnection -LocalPort 8000 -State Listen
foreach ($listener in $listeners) {
  Stop-Process -Id $listener.OwningProcess -Force
}

Write-Host "Quant-engine y cloudflared detenidos."
