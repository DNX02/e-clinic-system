$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $AppDir
$Port = 3000
$NodePath = "C:\Program Files\nodejs\node.exe"
$CloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$OutLog = Join-Path $RootDir "cloudflared.out.log"
$ErrLog = Join-Path $RootDir "cloudflared.err.log"
$UrlFile = Join-Path $RootDir "PUBLIC-LINKS.txt"
$StatusLog = Join-Path $RootDir "STARTUP-STATUS.log"
$NamedTunnelConfig = Join-Path $RootDir "cloudflared-config.yml"
$NoBrowser = $args -contains "-NoBrowser"

function Log-Step($message) {
  "$(Get-Date -Format s) $message" | Add-Content -Path $StatusLog -Encoding UTF8
}

Log-Step "start"

function Test-Server {
  try {
    Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/server-info" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Path $NodePath)) {
  Log-Step "node missing"
  throw "Node.js not found at $NodePath"
}

if (-not (Test-Path $CloudflaredPath)) {
  Log-Step "cloudflared missing"
  throw "cloudflared not found at $CloudflaredPath"
}

if (-not (Test-Server)) {
  Log-Step "starting node"
  Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory $RootDir -WindowStyle Hidden
  for ($i = 0; $i -lt 20 -and -not (Test-Server); $i++) {
    Start-Sleep -Milliseconds 500
  }
}

if (-not (Test-Server)) {
  Log-Step "server failed"
  throw "Local server did not start on port $Port"
}

Log-Step "server ok"
if (Test-Path $NamedTunnelConfig) {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
}
$existingTunnel = Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1
if ((Test-Path $NamedTunnelConfig) -and -not $existingTunnel) {
  Log-Step "starting named cloudflared tunnel"
  Remove-Item -LiteralPath $OutLog,$ErrLog -ErrorAction SilentlyContinue
  Start-Process -FilePath $CloudflaredPath `
    -ArgumentList "tunnel --config `"$NamedTunnelConfig`" run e-clinic-control" `
    -WorkingDirectory $RootDir `
    -WindowStyle Hidden
} elseif (-not $existingTunnel) {
  Log-Step "starting cloudflared"
  Remove-Item -LiteralPath $OutLog,$ErrLog -ErrorAction SilentlyContinue
  Start-Process -FilePath $CloudflaredPath `
    -ArgumentList "tunnel --url http://127.0.0.1:$Port --no-autoupdate --logfile `"$ErrLog`"" `
    -WorkingDirectory $RootDir `
    -WindowStyle Hidden
} else {
  Log-Step "cloudflared already running"
}

$links = $null
if (Test-Path $NamedTunnelConfig) {
  Start-Sleep -Seconds 3
  $links = @(
    "Public web server: https://doctor.e-clinic-control.ru/",
    "App #1 Admin: https://admin.e-clinic-control.ru/",
    "App #2 Doctor: https://doctor.e-clinic-control.ru/",
    "App #3 Patient survey: https://survey.e-clinic-control.ru/",
    "App #4 Doctor knowledge: https://training.e-clinic-control.ru/",
    "App #5 Nurse knowledge: https://nurse.e-clinic-control.ru/"
  )
} else {
  $publicUrl = $null
  for ($i = 0; $i -lt 40; $i++) {
    Log-Step "reading tunnel url attempt $i"
    Start-Sleep -Milliseconds 500
    if (Test-Path $ErrLog) {
      $content = Get-Content $ErrLog -Raw
      $match = [regex]::Match($content, "https://[a-z0-9-]+\.trycloudflare\.com")
      if ($match.Success) {
        $publicUrl = $match.Value
        break
      }
    }
  }

  if (-not $publicUrl) {
    Log-Step "public url missing"
    throw "Public tunnel URL was not created. Check cloudflared.err.log"
  }

  Log-Step "public url $publicUrl"
  $links = @(
    "Public web server: $publicUrl/",
    "App #1 Admin: $publicUrl/app-1-admin-panel",
    "App #2 Doctor: $publicUrl/app-2-doctor",
    "App #3 Patient survey: $publicUrl/app-3-patient-survey",
    "App #4 Doctor knowledge: $publicUrl/app-4-doctor-knowledge",
    "App #5 Nurse knowledge: $publicUrl/app-5-nurse-knowledge"
  )
}

$links | Set-Content -Path $UrlFile -Encoding UTF8
Log-Step "links written"
if (-not $NoBrowser) {
  Start-Process $publicUrl
}
Log-Step "done"
Write-Host ($links -join [Environment]::NewLine)
