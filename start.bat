@echo off
REM Downstream Hub — Start with Docker (double-click or run start.bat)
cd /d "%~dp0"

if not exist .env (
    copy .env.example .env
    echo Created .env from .env.example
)

REM Force Docker client to use API 1.43 (avoids 500 if Desktop doesn't support 1.51)
set "DOCKER_API_VERSION=1.43"
echo Using DOCKER_API_VERSION=%DOCKER_API_VERSION%
echo.
echo Building and starting containers...
docker compose up --build
pause
