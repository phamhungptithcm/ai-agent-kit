param(
    [switch]$CheckOnly,
    [switch]$Hook,
    [switch]$ApplyTools
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

function Test-PythonCommand {
    param(
        [string]$Command,
        [string[]]$PrefixArgs = @()
    )
    try {
        $output = & $Command @PrefixArgs --version 2>&1
        if ($LASTEXITCODE -eq 0 -and ($output -join "`n") -match "Python 3\.") {
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

function Resolve-Python {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        if (Test-PythonCommand "py" @("-3")) {
            return @{ Command = "py"; Args = @("-3") }
        }
    }
    foreach ($candidate in @("python", "python3")) {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) {
            if (Test-PythonCommand $candidate) {
                return @{ Command = $candidate; Args = @() }
            }
        }
    }
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return @{ Command = "uv"; Args = @("run", "--python", "3.11", "python") }
    }
    return $null
}

function Invoke-RepoPython {
    param(
        [hashtable]$Python,
        [string]$Script,
        [string[]]$ScriptArgs = @()
    )
    Push-Location $RepoRoot
    try {
        & $Python.Command @($Python.Args) $Script @ScriptArgs
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

$Python = Resolve-Python
if (-not $Python) {
    Write-Error "Repository Intelligence Gate BLOCKED: Python 3.11+ or uv is required."
    exit 1
}

if ($Hook) {
    exit (Invoke-RepoPython $Python ".ai/scripts/check-repository-intelligence.py" @("--hook"))
}

Write-Host "Repository intelligence bootstrap"
Write-Host ("OS: {0}" -f [System.Runtime.InteropServices.RuntimeInformation]::OSDescription)
Write-Host ("Architecture: {0}" -f [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)
Write-Host ("Repository: {0}" -f $RepoRoot)

if ($CheckOnly) {
    exit (Invoke-RepoPython $Python ".ai/scripts/check-repository-intelligence.py" @())
}

if ($ApplyTools) {
    $installExit = Invoke-RepoPython $Python ".ai/scripts/install-repository-intelligence.py" @("--apply")
    if ($installExit -ne 0) { exit $installExit }
} else {
    $installExit = Invoke-RepoPython $Python ".ai/scripts/install-repository-intelligence.py" @()
    if ($installExit -ne 0) { exit $installExit }
}

$indexExit = Invoke-RepoPython $Python ".ai/scripts/index-repository.py" @()
if ($indexExit -ne 0) { exit $indexExit }

exit (Invoke-RepoPython $Python ".ai/scripts/check-repository-intelligence.py" @())
