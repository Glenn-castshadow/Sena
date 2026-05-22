# Self-elevate if not already running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Start-Process PowerShell -Verb RunAs "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "Adding firewall rule for Sena Job Tracker (port 3000)..." -ForegroundColor Cyan

# Remove old rule if it exists
Remove-NetFirewallRule -DisplayName "Sena Job Tracker" -ErrorAction SilentlyContinue

# Add new rule — private networks only (office/home LAN)
New-NetFirewallRule `
    -DisplayName "Sena Job Tracker" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 3000 `
    -Action Allow `
    -Profile Private,Domain | Out-Null

Write-Host ""
Write-Host " Done! Firewall rule added." -ForegroundColor Green
Write-Host ""

# Show LAN IP
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.*" } | Select-Object -First 1).IPAddress
Write-Host " Devices on your network can now open:" -ForegroundColor Yellow
Write-Host " http://$($ip):3000" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to close..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
