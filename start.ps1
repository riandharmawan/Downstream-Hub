# Downstream Hub — Start with Docker (PowerShell)
# Double-click or run: .\start.ps1

Set-Location $PSScriptRoot

# Use a Docker API version compatible with Docker Desktop (avoids 500 on image pull)
$env:DOCKER_API_VERSION = "1.43"

if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "Created .env from .env.example"
}

Write-Host "Building and starting containers..."
docker compose up --build
