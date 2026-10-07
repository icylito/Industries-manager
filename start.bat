@echo off
rem Starts the API and the page, each in its own window. Close a window to stop it.
rem   start.bat            this PC only, over http
rem   start.bat https      this PC only, over https
rem   start.bat share      the page on the Wi-Fi over https, for a phone or a coworker's PC. The API and the database stay on this PC
rem   start.bat share db   the same, and the database opens to the network too (password postgres, anyone on the Wi-Fi can reach it)

rem The Docker database listens on this PC only, unless share db opens it
set "DB_BIND=127.0.0.1"
if /i "%~1"=="share" if /i "%~2"=="db" set "DB_BIND=0.0.0.0"

rem Start the Docker database when there's no settings file or the settings point at it (port 5433)
set "settings=%~dp0api_v2\appsettings.Development.json"
set "usedocker=0"
if not exist "%settings%" set "usedocker=1"
if exist "%settings%" findstr /c:"Port=5433" "%settings%" >nul && set "usedocker=1"
rem A settings file with no ApiV2 connection string also makes the API use the Docker database
if exist "%settings%" findstr /c:"ApiV2" "%settings%" >nul || set "usedocker=1"
if "%usedocker%"=="1" (
    echo Starting the Docker database...
    docker compose -f "%~dp0docker-compose.yml" up -d --wait || echo Docker didn't start, open Docker Desktop and run this again
)

rem https and share use the API's development certificate for the page too, so this PC trusts both.
rem It needs making and trusting once: dotnet dev-certs https --trust
set "ssl=--ssl --ssl-cert .cert\localhost.pem --ssl-key .cert\localhost.key"
if /i "%~1"=="https" call :cert
if /i "%~1"=="share" call :cert
if /i "%~1"=="share" goto share
if /i "%~1"=="https" (
    start "api_v2" cmd /k "cd /d "%~dp0api_v2" && dotnet run --launch-profile https --Https:Required=true"
    start "angular" cmd /k "cd /d "%~dp0angular" && npx ng serve %ssl%"
    echo API      https://localhost:7165
    echo Page     https://localhost:4200
) else (
    start "api_v2" cmd /k "cd /d "%~dp0api_v2" && dotnet run --launch-profile http"
    start "angular" cmd /k "cd /d "%~dp0angular" && npx ng serve"
    echo API      http://localhost:5005
    echo Page     http://localhost:4200
)
goto :eof

:share
rem The page listens on the network, and passes /api on to the API on this PC (angular\proxy.share.json)
start "api_v2" cmd /k "cd /d "%~dp0api_v2" && dotnet run --launch-profile https --Https:Required=true"
start "angular" cmd /k "cd /d "%~dp0angular" && npx ng serve %ssl% --host 0.0.0.0 --proxy-config proxy.share.json"
set "ip="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"`) do set "ip=%%i"
if not defined ip set "ip=this-pc-address"
echo Page on this PC      https://localhost:4200
echo Page on the Wi-Fi    https://%ip%:4200
echo The phone shows a certificate warning the first time, continue past it. If Windows asks about the firewall, allow private networks
if "%DB_BIND%"=="0.0.0.0" echo Database on the Wi-Fi  %ip%:5433, user postgres, password postgres
goto :eof

:cert
if not exist "%~dp0angular\.cert\localhost.pem" (
    mkdir "%~dp0angular\.cert" 2>nul
    dotnet dev-certs https --export-path "%~dp0angular\.cert\localhost.pem" --format Pem --no-password
)
goto :eof
