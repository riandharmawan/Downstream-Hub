@echo off
REM Run this ONCE if you get "500 Internal Server Error" / "unable to get image" when using start.bat
REM This sets Docker to use API version 1.43 for your user account (persistent).

setx DOCKER_API_VERSION "1.43"
if %ERRORLEVEL% equ 0 (
    echo.
    echo DOCKER_API_VERSION has been set to 1.43 for your user.
    echo.
    echo IMPORTANT: Close this window, then:
    echo   1. Close Docker Desktop completely (right-click tray icon -^> Quit).
    echo   2. Start Docker Desktop again.
    echo   3. Double-click start.bat again.
    echo.
) else (
    echo Failed to set variable. Try running this script as Administrator.
)
pause
