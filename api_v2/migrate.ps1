# Creates a migration from the current C# model. The API applies it by itself on its next start, see
# backend\Infrastructure\Startup\MigrationService.cs. The migrations live beside the contexts in
# backend\Infrastructure\Persistence, and this folder (the host) is what dotnet ef starts to find them.
#
# Two chains, pick the one the change belongs to:
#   Data   the tables that travel in time (Persistence\DataModel.cs): industries, rules, the Tables page
#   State  what is always current (Persistence\StateModel.cs): accounts, notes, the Scratchpad, requests, settings
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
    # dotnet-ef is pinned in dotnet-tools.json at the repo root
    dotnet tool restore
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $project = "..\backend\Infrastructure"
    if ($Context -eq "Data") {
        dotnet ef migrations add $Name --project $project --startup-project . --context DataMigrationsContext --output-dir Persistence\Migrations --namespace api_v2.Migrations
    }
    else {
        dotnet ef migrations add $Name --project $project --startup-project . --context StateMigrationsContext --output-dir Persistence\Migrations\State --namespace api_v2.Migrations.State
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Created $Context migration $Name. Restart the API and it applies it automatically."
}
finally {
    Pop-Location
}
