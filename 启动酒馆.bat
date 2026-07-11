@echo off
setlocal
set "ROOT=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js or add it to PATH.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=$env:ROOT; $port=8787; $existing=Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1; if ($existing) { Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500 }; Start-Process -FilePath 'node.exe' -ArgumentList 'image-proxy.js' -WorkingDirectory $root -WindowStyle Hidden; Start-Sleep -Milliseconds 800; Start-Process -FilePath (Join-Path $root 'index.html')"

endlocal
