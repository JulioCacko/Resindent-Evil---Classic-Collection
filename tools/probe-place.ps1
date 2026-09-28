# probe-place.ps1 - does the shipped window helper place each title's window?
#
# The embedding probes answered the question for RE1 only, and the three titles are not the same animal:
#
#   RE1   Biohazard.exe        RE-Enhance loader, MOD SELECTION dialog, `FullScreen?` in config.ini
#   RE2   RE2Launcher.exe      RE-Enhance loader, no `FullScreen?` key at all - `Display_mode` instead
#   RE3   RE3Launcher.exe      the same shape as RE2
#
# So "it works on RE1" says nothing about the other two, and this runs the production path against each
# of them in turn: launch the title the way the launcher does, ask `resources/window-host.ps1` where its
# window is, ask it to place that window on a rectangle, and check whether the client area landed there.
#
# It uses the shipped helper rather than its own P/Invoke on purpose: a probe with its own implementation
# can pass while the thing that ships is broken.
#
# Usage:
#   pwsh -File tools/probe-place.ps1 -Title RE2 -Dir "<install>" -Exe RE2Launcher.exe

param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$DialogStrategy = 'down-enter',
  [int]$WaitSeconds = 60,
  [int]$TargetX = 120,
  [int]$TargetY = 60,
  [int]$TargetWidth = 1300,
  [int]$TargetHeight = 975
)

$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '..\resources\window-host.ps1'

if (-not ('PlaceProbe.Win32' -as [type])) {
  Add-Type -Namespace PlaceProbe -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
'@
}
$VK_RETURN = 13
$VK_DOWN = 40
$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101

function Get-Windows([int]$ProcessId) {
  $json = & pwsh -NoProfile -File $helper -Action query -ProcessId $ProcessId | Select-Object -Last 1
  $parsed = $json | ConvertFrom-Json
  return @($parsed.windows)
}

function Answer-Dialog([string]$Handle, [string]$Class) {
  $raw = [IntPtr][Convert]::ToInt64($Handle.Substring(2), 16)
  [void][PlaceProbe.Win32]::SetForegroundWindow($raw)
  Start-Sleep -Milliseconds 400
  if ($DialogStrategy -eq 'down-enter') {
    [void][PlaceProbe.Win32]::PostMessage($raw, $WM_KEYDOWN, [IntPtr]$VK_DOWN, [IntPtr]::Zero)
    [void][PlaceProbe.Win32]::PostMessage($raw, $WM_KEYUP, [IntPtr]$VK_DOWN, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 250
  }
  [void][PlaceProbe.Win32]::PostMessage($raw, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
  [void][PlaceProbe.Win32]::PostMessage($raw, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
  Write-Output "    answered the '$Class' dialog with $DialogStrategy"
}

# --- the config the launcher writes, plus windowed mode when the title has such a key -------------
$iniPath = Join-Path $Dir 'config.ini'
$iniOriginal = if (Test-Path $iniPath) { [System.IO.File]::ReadAllText($iniPath) } else { $null }
if ($null -ne $iniOriginal) {
  $patched = $iniOriginal -replace '(?m)^(FullScreen\?\s*=\s*).*$', '${1}0'
  $patched = $patched -replace '(?m)^(BootConfig\s*=\s*).*$', '${1}0'
  [System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
  $hasFullScreen = $iniOriginal -match '(?m)^FullScreen\?'
  Write-Output "  config.ini: BootConfig=0; windowed key present: $hasFullScreen"
}

$process = $null
try {
  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "  launched $Exe (pid $($process.Id))"

  $answered = @{}
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $game = $null
  $stableFor = 0
  $lastHandle = ''

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) { break }
    $windows = @(Get-Windows -ProcessId $process.Id)

    foreach ($dialog in @($windows | Where-Object { $_.visible -and $_.class -eq '#32770' })) {
      if (-not $answered.ContainsKey($dialog.handle)) {
        Answer-Dialog -Handle $dialog.handle -Class $dialog.title
        $answered[$dialog.handle] = $true
        Start-Sleep -Seconds 2
      }
    }

    $candidate = @($windows | Where-Object { $_.visible -and $_.class -ne '#32770' -and $_.width -gt 400 -and $_.height -gt 300 } |
      Sort-Object { $_.width * $_.height } -Descending) | Select-Object -First 1
    if ($null -ne $candidate) {
      if ($candidate.handle -eq $lastHandle) { $stableFor += 1 } else { $stableFor = 0 }
      $lastHandle = $candidate.handle
      if ($stableFor -ge 2) { $game = $candidate; break }
    }
  }

  if ($process.HasExited) {
    Write-Output "  RESULT [$Title]: the game exited on its own (code $($process.ExitCode)) - it never reached a window"
    return
  }
  if ($null -eq $game) {
    Write-Output "  RESULT [$Title]: no stable game window within $WaitSeconds s"
    return
  }

  Write-Output "  window: $($game.handle) class=$($game.class) '$($game.title)' $($game.width)x$($game.height)"

  $placed = & pwsh -NoProfile -File $helper -Action position -ProcessId $process.Id `
    -X $TargetX -Y $TargetY -Width $TargetWidth -Height $TargetHeight | Select-Object -Last 1 | ConvertFrom-Json
  Write-Output "  place: found=$($placed.found) moved=$($placed.moved) client=$($placed.client.width)x$($placed.client.height) at window $($placed.window.x),$($placed.window.y)"

  # The client area is the requirement: the design's card describes pixels, not a frame.
  $placedAgain = & pwsh -NoProfile -File $helper -Action position -ProcessId $process.Id `
    -X $TargetX -Y $TargetY -Width $TargetWidth -Height $TargetHeight | Select-Object -Last 1 | ConvertFrom-Json
  $ok = $placedAgain.found -and $placedAgain.client.width -eq $TargetWidth -and $placedAgain.client.height -eq $TargetHeight
  Write-Output "  re-check: client=$($placedAgain.client.width)x$($placedAgain.client.height) window=$($placedAgain.window.x),$($placedAgain.window.y)"
  Write-Output "  exStyle $($placedAgain.exStyleBefore) -> $($placedAgain.exStyleAfter)"

  $released = & pwsh -NoProfile -File $helper -Action release -ProcessId $process.Id | Select-Object -Last 1 | ConvertFrom-Json
  Write-Output "  release: ok=$($released.ok) exStyle=$($released.exStyle)"

  if ($ok) { Write-Output "  RESULT [$Title]: PLACED - client area exactly ${TargetWidth}x${TargetHeight}" }
  else { Write-Output "  RESULT [$Title]: placed but the client area is $($placedAgain.client.width)x$($placedAgain.client.height)" }
} finally {
  if ($process -and -not $process.HasExited) {
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    Write-Output "  killed pid $($process.Id)"
  }
  if ($null -ne $iniOriginal) {
    [System.IO.File]::WriteAllText($iniPath, $iniOriginal, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output '  config.ini restored'
  }
}
