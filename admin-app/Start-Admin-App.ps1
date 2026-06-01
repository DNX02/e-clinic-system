$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $AppDir
$Port = 3000
$Url = "http://localhost:$Port/app-1-admin-panel"
$NodeCandidates = @(
  "C:\Program Files\nodejs\node.exe",
  "$env:LOCALAPPDATA\OpenAI\Codex\bin\node.exe"
)
$NodePath = $NodeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $NodePath) {
  $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($NodeCommand) {
    $NodePath = $NodeCommand.Source
  }
}

function Test-Server {
  try {
    Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/me" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not $NodePath) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Node.js not found. Install Node.js LTS and start Admin App again.", "Admin App")
  exit 1
}

if (-not (Test-Server)) {
  Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory $RootDir -WindowStyle Hidden
  $started = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Server) {
      $started = $true
      break
    }
  }
  if (-not $started) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Could not start local server. Check that port $Port is free.", "Admin App")
    exit 1
  }
}

Start-Process $Url
