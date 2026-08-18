$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$venvPath = Join-Path $projectRoot ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$webPath = Join-Path $projectRoot "apps\web"
$apiPath = Join-Path $projectRoot "services\api"
$dataPath = if ($env:BOOKMATE_DATA_DIR) { [System.IO.Path]::GetFullPath($env:BOOKMATE_DATA_DIR) } else { Join-Path $projectRoot "data" }
$webOutputPath = Join-Path $webPath "out"

# Load only known BookMate settings. Values are never printed, and an explicitly
# supplied process environment always takes precedence over the local .env file.
$envFile = Join-Path $projectRoot ".env"
if (Test-Path -LiteralPath $envFile) {
    $allowedSettings = @(
        "BOOKMATE_MODEL_PROTOCOL",
        "BOOKMATE_MODEL_BASE_URL",
        "BOOKMATE_MODEL_NAME",
        "BOOKMATE_MODEL_API_KEY",
        "BOOKMATE_MODEL_TIMEOUT_SECONDS",
        "BOOKMATE_MAX_UPLOAD_MB"
    )
    $legacyDeepSeekKey = $null
    foreach ($rawLine in Get-Content -LiteralPath $envFile) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) { continue }
        $separator = $line.IndexOf("=")
        if ($separator -lt 1) { continue }
        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
        if ($name -eq "deepseek-api") {
            $legacyDeepSeekKey = $value
            continue
        }
        if ($allowedSettings -contains $name -and -not (Test-Path "Env:$name")) {
            Set-Item -Path "Env:$name" -Value $value
        }
    }
    if ($legacyDeepSeekKey -and -not $env:BOOKMATE_MODEL_API_KEY) {
        if (-not $env:BOOKMATE_MODEL_PROTOCOL) { $env:BOOKMATE_MODEL_PROTOCOL = "chat_completions" }
        if (-not $env:BOOKMATE_MODEL_BASE_URL) { $env:BOOKMATE_MODEL_BASE_URL = "https://api.deepseek.com/v1" }
        if (-not $env:BOOKMATE_MODEL_NAME) { $env:BOOKMATE_MODEL_NAME = "deepseek-chat" }
        $env:BOOKMATE_MODEL_API_KEY = $legacyDeepSeekKey
    }
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python 3.11+ was not found. Install Python and enable Add Python to PATH."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js/npm was not found. Install Node.js 22+."
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "[BookMate] Creating the local Python environment..."
    python -m venv $venvPath
}

Write-Host "[BookMate] Preparing API dependencies..."
& $venvPython -m pip install --disable-pip-version-check -q -e $apiPath

Push-Location $webPath
try {
    if (-not (Test-Path -LiteralPath (Join-Path $webPath "node_modules"))) {
        Write-Host "[BookMate] Preparing Web dependencies..."
        npm.cmd ci
    }
    Write-Host "[BookMate] Building the local Web app..."
    npm.cmd run build
} finally {
    Pop-Location
}

$env:BOOKMATE_DATA_DIR = $dataPath
$env:BOOKMATE_WEB_DIR = $webOutputPath

Write-Host "[BookMate] Starting at http://localhost:8000"
Write-Host "[BookMate] Press Ctrl+C to stop. Local data is stored in $dataPath"
Push-Location $apiPath
try {
    & $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} finally {
    Pop-Location
}
