@echo off
rem Starts the API and the page, each in its own window. Close a window to stop it.

rem Start the Docker database when there's no settings file or the settings point at it (port 5433)
set "settings=%~dp0api_v2\appsettings.Development.json"
set "usedocker=0"
if not exist "%settings%" set "usedocker=1"
if exist "%settings%" findstr /c:"Port=5433" "%settings%" >nul && set "usedocker=1"
if "%usedocker%"=="1" (
    echo Starting the Docker database...
    docker compose -f "%~dp0docker-compose.yml" up -d --wait || echo Docker didn't start, open Docker Desktop and run this again
)

start "api_v2" cmd /k "cd /d "%~dp0api_v2" && dotnet run --launch-profile http"
start "angular" cmd /k "cd /d "%~dp0angular" && npx ng serve"

echo API      http://localhost:5005
echo Page     http://localhost:4200
