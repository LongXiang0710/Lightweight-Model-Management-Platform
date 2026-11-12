param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$platformUrl = "http://localhost:5173"

function Test-LocalPort {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connection = $client.ConnectAsync("127.0.0.1", $Port)
    if (-not $connection.Wait(500)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Show-LaunchError {
  param([string]$Message)

  if ($NoBrowser) {
    Write-Error $Message
    return
  }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, "Power Station Platform") | Out-Null
}

try {
  $nodeCandidates = @()
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
  $nodeCandidates += @(
    (Join-Path $env:ProgramFiles "nodejs\node.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  )
  $nodeExecutable = $nodeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $nodeExecutable) {
    throw "Node.js was not found."
  }

  if (-not (Test-LocalPort -Port 4173)) {
    Start-Process -FilePath $nodeExecutable -ArgumentList "backend.mjs" -WorkingDirectory $projectRoot -WindowStyle Hidden
  }
  if (-not (Test-LocalPort -Port 5173)) {
    Start-Process -FilePath $nodeExecutable -ArgumentList "frontend.mjs" -WorkingDirectory $projectRoot -WindowStyle Hidden
  }

  $ready = $false
  $deadline = (Get-Date).AddSeconds(20)
  do {
    if ((Test-LocalPort -Port 4173) -and (Test-LocalPort -Port 5173)) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)

  if (-not $ready) {
    Show-LaunchError "The local platform did not start within 20 seconds. Please check ports 4173 and 5173."
    exit 1
  }

  if ($NoBrowser) {
    Write-Output "READY $platformUrl"
  } else {
    Start-Process $platformUrl
  }
} catch {
  Show-LaunchError "Unable to start the platform: $($_.Exception.Message)"
  exit 1
}
