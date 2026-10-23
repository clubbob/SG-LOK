# Stop Next dev listeners on 3000-3005, clean .next, start a single dev server.
$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Stop-ListenersOnPort([int]$port) {
  $matches = netstat -ano | Select-String "LISTENING" | Select-String ":$port\s"
  foreach ($line in $matches) {
    $parts = ($line.ToString().Trim() -split '\s+')
    $procId = [int]$parts[-1]
    if ($procId -gt 0) {
      Write-Host "Stopping PID $procId (port $port)"
      Stop-Process -Id $procId -Force
    }
  }
}

foreach ($port in 3000..3005) {
  Stop-ListenersOnPort $port
}

# Orphan next dev for this repo (parent npm may respawn — stop start-server.js from sglok)
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  if ($_.CommandLine -like "*D:\project\sglok*" -and $_.CommandLine -like "*start-server*") {
    Write-Host "Stopping sglok next server PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }
}

Start-Sleep -Seconds 2

foreach ($port in 3000..3005) {
  Stop-ListenersOnPort $port
}

npm run clean
npm run dev
