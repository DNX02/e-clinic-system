$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $AppDir "Start-Public-Access.ps1"
$TaskName = "Medical Public Access"
$PowerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`" -NoBrowser"

cmd.exe /c "schtasks.exe /Delete /TN `"$TaskName`" /F >nul 2>nul"
schtasks.exe /Create /TN $TaskName /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "`"$PowerShell`" $Arguments" /F | Out-Null

Write-Host "Autostart task registered: $TaskName"
