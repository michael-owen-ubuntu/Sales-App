param(
    [Parameter(Mandatory)][string]$WorkerDirectory,
    [Parameter(Mandatory)][string]$Config,
    [Parameter(Mandatory)][string]$SettingsPath,
    [Parameter(Mandatory)][string]$CredentialPath,
    [Parameter(Mandatory)][string]$PythonPath
)

$ErrorActionPreference = "Stop"
$connection = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
$credential = Import-Clixml -LiteralPath $CredentialPath
$env:DISCOVERY_SUPABASE_URL = $connection.url
$env:DISCOVERY_SUPABASE_PUBLISHABLE_KEY = $connection.publishableKey
$env:DISCOVERY_EMAIL = $credential.UserName
$env:DISCOVERY_PASSWORD = $credential.GetNetworkCredential().Password

Push-Location -LiteralPath $WorkerDirectory
try {
    & $PythonPath -m discovery --config $Config --limit 30
    exit $LASTEXITCODE
} finally {
    Remove-Item Env:DISCOVERY_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
