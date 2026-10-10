# Creates a migration from the current C# model. The API applies it by itself on its next start, see
# Data/MigrationService.cs.
#
# Two chains, pick the one the change belongs to:
#   Data   the tables that travel in time (Data/DataModel.cs): industries, rules, the Tables page
#   State  what is always current (Data/StateModel.cs): accounts, notes, the Scratchpad, requests, settings
#
# Usage, after changing the model:
#   .\migrate.ps1 -Context Data -Name AddTickerColumn
#   dotnet run --launch-profile http
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Data", "State")]
    [string]$Context,
    [Parameter(Mandatory = $true)]
    [string]$Name
)

Push-Location $PSScriptRoot
try {
    if ($Context -eq "Data") {
        dotnet ef migrations add $Name --context DataMigrationsContext --output-dir Migrations
    }
    else {
        dotnet ef migrations add $Name --context StateMigrationsContext --output-dir Migrations/State
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Created $Context migration $Name. Restart the API and it applies it automatically."
}
finally {
    Pop-Location
}
