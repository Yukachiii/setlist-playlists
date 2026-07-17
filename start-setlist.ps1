param(
    [ValidateSet("admin", "public", "no-open")]
    [string]$Mode = "admin"
)

$HostName = "127.0.0.1"
$Port = 8765
$BaseUrl = "http://${HostName}:${Port}/"
$OpenUrl = if ($Mode -eq "public") { $BaseUrl } else { "${BaseUrl}admin/" }
$OpenBrowser = $Mode -ne "no-open"

Set-Location -LiteralPath $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Setlist Playlists Local Server"

function Test-SetlistServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $BaseUrl -TimeoutSec 1
        return $response.StatusCode -eq 200 -and $response.Content -match "Setlist"
    }
    catch {
        return $false
    }
}

if (Test-SetlistServer) {
    Write-Host "Setlist server is already running: $BaseUrl"
    if ($OpenBrowser) {
        Start-Process $OpenUrl
    }
    exit 0
}

$python = Get-Command py.exe -ErrorAction SilentlyContinue
$pythonArgs = @("-3")
if (-not $python) {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    $pythonArgs = @()
}

if (-not $python) {
    Write-Host ""
    Write-Host "Python was not found." -ForegroundColor Red
    Write-Host "Install Python or check the PATH setting."
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host ""
Write-Host "Starting Setlist Playlists."
Write-Host "Admin:  ${BaseUrl}admin/"
Write-Host "Public: $BaseUrl"
Write-Host ""
Write-Host "Press Ctrl+C in this window to stop the server."
Write-Host ""

if ($OpenBrowser) {
    $escapedUrl = $OpenUrl.Replace("'", "''")
    $browserCommand = "Start-Sleep -Milliseconds 800; Start-Process '$escapedUrl'"
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
        "-NoProfile",
        "-WindowStyle", "Hidden",
        "-Command", $browserCommand
    )
}

& $python.Source @pythonArgs "server.py" "--bind" $HostName "--port" $Port
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Write-Host ""
    Write-Host "Could not start the server. Check whether port $Port is already in use." -ForegroundColor Red
    Read-Host "Press Enter to close"
}

exit $exitCode
