# Makes a copy of the project to run on this PC or another one.
#
#   powershell -ExecutionPolicy Bypass -File testing\make-copy.ps1
#     A clean copy: code only, no data, no backup key, no database login. The copy makes its own key and
#     starts empty, so every host runs exactly its own data.
#
#   powershell -ExecutionPolicy Bypass -File testing\make-copy.ps1 -WithData
#     A copy with this PC's data, backups and backup key included. Use it to test that the backups do not
#     transfer: run it here, then on another device, and check with testing\transfer-check.
#
# The data folders are excluded by full path, so api_v2\Backups (the code) is always kept.

param(
    [string]$Destination = (Join-Path $env:USERPROFILE "Desktop\stock-listing-copy"),
    [switch]$WithData
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if ((Test-Path $Destination) -and (Get-ChildItem $Destination -Force | Select-Object -First 1)) {
    throw "$Destination already has files. Pick an empty folder or delete it first."
}

# Folders and files that hold data on this PC. Excluded unless -WithData.
$dataDirs = @("backups", "backup-key", "scratchpad-files", "user-tables", "profile-pictures", "shots", "testing\throwaway-backups") |
    ForEach-Object { Join-Path $root $_ }
$dataFiles = @("api_v2\appsettings.Development.json", "api_v2\appsettings.Throwaway.json", "scripts\seeding.control.toml") |
    ForEach-Object { Join-Path $root $_ }

# Build and tool output, and dependencies. Always excluded, they come back with a build. Matched by name anywhere
# in the tree, except .vscode, which is only the root one (angular/.vscode is shared and tracked).
$buildDirs = @(".git", "node_modules", "bin", "obj", ".angular", "dist", "artifacts", ".npm-cache", ".pw-browsers", "__pycache__", ".superpowers")

$excludeDirs = @()
if (-not $WithData) { $excludeDirs += $dataDirs }
$excludeDirs += Join-Path $root ".vscode"
$excludeDirs += $buildDirs
$excludeFiles = @()
if (-not $WithData) { $excludeFiles += $dataFiles }

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$robocopyArgs = @($root, $Destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1")
if ($excludeDirs.Count -gt 0) { $robocopyArgs += "/XD"; $robocopyArgs += $excludeDirs }
if ($excludeFiles.Count -gt 0) { $robocopyArgs += "/XF"; $robocopyArgs += $excludeFiles }

& robocopy @robocopyArgs | Out-Null
# robocopy: 0 to 7 mean the copy worked, 8 and above mean it failed
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

$kind = if ($WithData) { "with this PC's data" } else { "clean, no data" }
Write-Output "Copied the project ($kind) to $Destination"
if ($WithData) {
    $key = Join-Path $Destination "backup-key\backup-signing.key"
    $count = (Get-ChildItem (Join-Path $Destination "backups") -Directory -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Output "  backups in the copy: $count, backup key present: $(Test-Path $key)"
}

exit 0
