# Creates a migration from the current C# model (Model/ and Data/AppDbContext.cs).
# The API applies it by itself on its next start, see Data/MigrationService.cs.
#
# Usage, after changing the model:
#   .\migrate.ps1 -Name AddTickerColumn
#   dotnet run --launch-profile http
param(
    [Parameter(Mandatory = $true)]
    [string]$Name
)

Push-Location $PSScriptRoot
try {
    dotnet ef migrations add $Name
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Created migration $Name. Restart the API and it applies it automatically."
}
finally {
    Pop-Location
}
