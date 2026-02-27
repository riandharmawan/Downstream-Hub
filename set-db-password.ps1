# Set PostgreSQL 'hub' user password to match current .env (fixes pgAdmin "password authentication failed")
# Run with: powershell -ExecutionPolicy Bypass -File set-db-password.ps1
# Requires: Docker running, downstream-hub-db container up

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Host "ERROR: .env not found in project root." -ForegroundColor Red
    exit 1
}

# Parse POSTGRES_PASSWORD: take the line, strip after #, trim, remove surrounding quotes
$line = Get-Content $envPath | Where-Object { $_ -match '^\s*POSTGRES_PASSWORD\s*=' } | Select-Object -First 1
if (-not $line) {
    Write-Host "ERROR: POSTGRES_PASSWORD not found in .env" -ForegroundColor Red
    exit 1
}
$pass = ($line -replace '^[^=]+=', '').Split('#')[0].Trim() -replace '^["'']|["'']$'
# Escape single quotes for SQL: ' -> ''
$passEsc = $pass -replace "'", "''"

$sql = "ALTER USER hub PASSWORD '$passEsc';"
Write-Host "Setting PostgreSQL user 'hub' password to match .env ..." -ForegroundColor Cyan
& docker exec downstream-hub-db psql -U hub -d downstream_hub -c $sql
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed. Is Docker running and container 'downstream-hub-db' up? Run start.bat first." -ForegroundColor Red
    exit 1
}

# Verify: connect via TCP with this password (same as pgAdmin)
Write-Host "Verifying password (TCP connection like pgAdmin) ..." -ForegroundColor Cyan
& docker exec -e "PGPASSWORD=$pass" downstream-hub-db psql -h 127.0.0.1 -U hub -d downstream_hub -c "SELECT 1 AS ok;"
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Password set but TCP login failed. See tips below." -ForegroundColor Yellow
} else {
    Write-Host "Password verified (TCP login works)." -ForegroundColor Green
}
Write-Host ""
Write-Host "In pgAdmin: use Host 127.0.0.1, Port 5432, User hub, Database downstream_hub, and the POSTGRES_PASSWORD from .env." -ForegroundColor Cyan
Write-Host "If it still fails: remove the server in pgAdmin and add it again (do not use a saved password)." -ForegroundColor Cyan
