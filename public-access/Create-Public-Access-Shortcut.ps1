$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $AppDir "Start-Public-Access.cmd"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Medical Public Access.lnk"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Launcher
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.Description = "Start public internet access for the medical system"
$Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,110"
$Shortcut.Save()

Write-Host "Shortcut created: $ShortcutPath"
