# probe-overlay.ps1 - does the achievement toast actually draw over a real game?
#
# Every other check of the overlay runs in a controlled process: `native/testhost` creates a real D3D9
# device and the plugin draws into it, and `pnpm test` asserts the composed card's colours from a file.
# None of that answers the question a player would ask, which is whether the toast appears on top of the
# game. This does, by measuring the screen.
#
# The method is two captures of the same rectangle - one before a toast and one during it - and a count
# of the colours the design uses in both. A single capture proves nothing: RE3 is sepia and dark, and
# gold-ish pixels exist in the game's own art. The DIFFERENCE is the evidence.
#
# Usage:
#   pwsh -File tools/probe-overlay.ps1 -Dir "GOG Games\Resident Evil 3" -Exe 'BIOHAZARD(R) 3 PC.exe'

param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Title = 'RE3',
  [string]$Plugin = '',
  [int]$WaitSeconds = 75,
  # Print every window the process owns - with its rect and whether it is the foreground window - and
  # stop. Added because the probe spent two rounds sampling the desktop: "the largest visible window" is
  # a heuristic, and the saved screenshot showed the game's real window somewhere else entirely.
  [switch]$Inspect
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $repoRoot 'resources\window-host.ps1'
if ($Plugin -eq '') { $Plugin = Join-Path $repoRoot 'resources\re_classic_overlay.asi' }
if (-not (Test-Path $Plugin)) { throw "no plugin at $Plugin - run: pnpm build:overlay" }

Add-Type -AssemblyName System.Drawing
if (-not ('OverlayProbe.Win32' -as [type])) {
  Add-Type -Namespace OverlayProbe -Name Win32 -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
[DllImport("user32.dll")] public static extern bool ClientToScreen(System.IntPtr hWnd, ref POINT lpPoint);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@
}

function Convert-Handle([string]$h) { return [IntPtr][Convert]::ToInt64($h.Substring(2), 16) }

# THE GAME MUST BE IN FRONT, and this is the whole reason two rounds of measurements read the desktop.
 #
 # RE3 owns exactly one real window (`Bio3` at 960,456 - confirmed with -Inspect) and that IS where the
 # probe sampled. What was wrong was that the window was BEHIND the browser: `CopyFromScreen` copies the
 # *screen*, so it faithfully returned whatever was on top of the game. A single `SetForegroundWindow`
 # is not reliable here - Windows refuses it for a process that is not already in the foreground - so it
 # is retried, falls back to `WScript.Shell.AppActivate`, and its result is REPORTED rather than assumed.
function Bring-ToFront([IntPtr]$Hwnd, [int]$ProcessId) {
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    if ([OverlayProbe.Win32]::GetForegroundWindow() -eq $Hwnd) { return $true }
    [void][OverlayProbe.Win32]::ShowWindow($Hwnd, 9)
    [void][OverlayProbe.Win32]::SetForegroundWindow($Hwnd)
    Start-Sleep -Milliseconds 400
  }
  try {
    (New-Object -ComObject WScript.Shell).AppActivate($ProcessId) | Out-Null
    Start-Sleep -Milliseconds 700
  } catch { }
  return ([OverlayProbe.Win32]::GetForegroundWindow() -eq $Hwnd)
}

function Get-Windows([int]$ProcessId) {
  $json = & pwsh -NoProfile -File $helper -Action query -ProcessId $ProcessId 2>$null | Select-Object -Last 1
  if ($null -eq $json -or $json -eq '') { return @() }
  try { return @(($json | ConvertFrom-Json).windows) } catch { return @() }
}

# The design's own tokens, from overlays/AchievementToast.tsx. `gold` is the glyph, the eyebrow and the
# progress underline; `plate` is the card's ground.
function Measure-Region([System.Drawing.Bitmap]$Bitmap, [int]$x, [int]$y, [int]$w, [int]$h) {
  $gold = 0; $plate = 0; $lit = 0; $total = 0
  for ($py = $y; $py -lt ($y + $h); $py += 1) {
    for ($px = $x; $px -lt ($x + $w); $px += 1) {
      if ($px -lt 0 -or $py -lt 0 -or $px -ge $Bitmap.Width -or $py -ge $Bitmap.Height) { continue }
      $p = $Bitmap.GetPixel($px, $py)
      $total++
      if ([Math]::Abs($p.R - 212) -lt 40 -and [Math]::Abs($p.G - 175) -lt 40 -and [Math]::Abs($p.B - 55) -lt 50) { $gold++ }
      if ([Math]::Abs($p.R - 26) -lt 10 -and [Math]::Abs($p.G - 26) -lt 10 -and [Math]::Abs($p.B - 26) -lt 10) { $plate++ }
      if ((0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B) -gt 8) { $lit++ }
    }
  }
  return @{ gold = $gold; plate = $plate; lit = $lit; total = $total }
}

$probeName = Split-Path -Leaf $Plugin
$probeDest = Join-Path $Dir $probeName
$probeExisted = Test-Path $probeDest
$iniPath = Join-Path $Dir 'config.ini'
$iniOriginal = if (Test-Path $iniPath) { [System.IO.File]::ReadAllText($iniPath) } else { $null }

$process = $null
$pipe = $null
try {
  Write-Output "=== $Title ==="

  # The probe turns the plugin's own two diagnostics on itself, rather than depending on whoever runs it
  # to remember: without these the plugin never reads a frame back, so the verdict below would have
  # nothing to judge by - which is how earlier runs reported "no toast detected" with no evidence either
  # way.
  $env:RE_OVERLAY_LOG = '1'
  $env:RE_OVERLAY_CAPTURE = '1'

  Copy-Item -Path $Plugin -Destination $probeDest -Force
  Write-Output "  plugin  : $probeName -> $probeDest"

  # The typeface too, because the plugin loads it privately from beside itself and falls back to Arial
  # without it - which would make a draw that worked look wrong rather than look absent. The launcher's
  # real injection copies both (src/main/ipc.ts), so the probe copies both.
  $fontSource = Join-Path $repoRoot 'resources\Actor-Regular.ttf'
  $fontDest = Join-Path $Dir 'Actor-Regular.ttf'
  $fontExisted = Test-Path $fontDest
  if (Test-Path $fontSource) {
    Copy-Item -Path $fontSource -Destination $fontDest -Force
    Write-Output '  typeface: Actor-Regular.ttf copied beside it'
  } else {
    Write-Output '  typeface: MISSING - the toast would fall back to Arial'
  }

  if ($null -ne $iniOriginal) {
    $patched = $iniOriginal -replace '(?m)^(FullScreen\?\s*=\s*).*$', '${1}0'
    $patched = $patched -replace '(?m)^(BootConfig\s*=\s*).*$', '${1}0'
    if ($patched -ne $iniOriginal) {
      [System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
      Write-Output '  config  : windowed (FullScreen?/BootConfig = 0), restored at the end'
    }
  }

  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "  launched: $Exe (pid $($process.Id))"

  $game = $null
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline -and $null -eq $game) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) { break }
    $game = @(Get-Windows -ProcessId $process.Id | Where-Object { $_.visible -and $_.width -gt 400 -and $_.height -gt 300 } |
      Sort-Object { $_.width * $_.height } -Descending) | Select-Object -First 1
  }
  if ($null -eq $game) { Write-Output "  RESULT: no game window within $WaitSeconds s"; return }

  $handle = Convert-Handle $game.handle

  if ($Inspect) {
    $front = [OverlayProbe.Win32]::GetForegroundWindow()
    Write-Output ("  foreground: 0x{0:X}" -f $front.ToInt64())
    foreach ($candidate in @(Get-Windows -ProcessId $process.Id)) {
      $candidateHandle = Convert-Handle $candidate.handle
      $candidateRect = New-Object OverlayProbe.Win32+RECT
      [void][OverlayProbe.Win32]::GetWindowRect($candidateHandle, [ref]$candidateRect)
      $mark = if ($candidateHandle -eq $front) { 'FOREGROUND' } else { '' }
      Write-Output ("  window: {0,-10} class={1,-12} visible={2,-5} {3}x{4} at {5},{6} {7}" -f `
          $candidate.handle, $candidate.class, $candidate.visible, $candidate.width, $candidate.height, `
          $candidateRect.Left, $candidateRect.Top, $mark)
    }
    return
  }

  [void][OverlayProbe.Win32]::ShowWindow($handle, 9)
  # NEVER FATAL. The foreground step exists only for the screen capture, and the measurement that matters
  # now is the plugin's own render-target readback, which does not care what is on top. An earlier version
  # let a failure here end the run before it connected to the pipe, which threw away a working measurement
  # for the sake of a picture - and reported nothing about why.
  $brought = $false
  try {
    $brought = Bring-ToFront -Hwnd $handle -ProcessId $process.Id
  } catch {
    Write-Output "  front   : the attempt failed: $($_.Exception.Message)"
  }
  Write-Output "  front   : the game is in front: $brought (only the screen capture depends on this)"
  Start-Sleep -Seconds 2

  $windowRect = New-Object OverlayProbe.Win32+RECT
  [void][OverlayProbe.Win32]::GetWindowRect($handle, [ref]$windowRect)
  $clientRect = New-Object OverlayProbe.Win32+RECT
  [void][OverlayProbe.Win32]::GetClientRect($handle, [ref]$clientRect)
  $cw = $clientRect.Right; $ch = $clientRect.Bottom
  Write-Output "  window  : class=$($game.class) $($game.width)x$($game.height), client ${cw}x${ch} at $($windowRect.Left),$($windowRect.Top)"

  # Where the toast must be, from the design: 2 px inset right and 30 px inset top of a 1920-wide canvas,
  # scaled by the back buffer (the plugin floors that scale at 0.5 - toast-render.cpp). The card is 420
  # authored pixels wide, and its height for a two-line description is bounded generously here.
  $scale = [Math]::Max(0.5, $cw / 1920.0)
  $boxW = [int](430 * $scale) + 4
  $boxH = [int](130 * $scale) + 8
  $boxX = $cw - $boxW - 2
  $boxY = 0
  Write-Output "  toast   : scale=$([Math]::Round($scale,3)) box=${boxW}x${boxH} at $boxX,$boxY (client pixels)"

  # THE CLIENT ORIGIN, not the window origin, and this was the probe's own bug for two rounds.
  #
  # The toast box below is expressed in CLIENT pixels - the plugin positions and scales it against the
  # device's back buffer, which is the client area. Sampling from `windowRect.Left/Top` puts the box on
  # the window's TITLE BAR instead: a flat dark grey, which is why every run reported
  # `plate=15987 of 15987` and a uniform (26,26,26) region that had nothing to do with the game.
  $clientOrigin = New-Object OverlayProbe.Win32+POINT
  $clientOrigin.X = 0
  $clientOrigin.Y = 0
  [void][OverlayProbe.Win32]::ClientToScreen($handle, [ref]$clientOrigin)
  Write-Output "  client  : origin $($clientOrigin.X),$($clientOrigin.Y) (window origin $($windowRect.Left),$($windowRect.Top))"

  function Capture-Client {
    # Re-assert the foreground before every capture, and by verification rather than by asking: a capture
    # taken while another window is on top is a picture of that window, which is what the probe returned
    # for two rounds while looking perfectly plausible.
    if ([OverlayProbe.Win32]::GetForegroundWindow() -ne $handle) {
      try { [void](Bring-ToFront -Hwnd $handle -ProcessId $process.Id) } catch { }
    }
    $front = [OverlayProbe.Win32]::GetForegroundWindow() -eq $handle
      # `Write-Host`, NOT `Write-Output`, and this is the whole bug this function had: a PowerShell
      # function's return value is its ENTIRE OUTPUT STREAM, so a warning printed with `Write-Output`
      # leaves with the bitmap as a two-element array. The caller then hands an Object[] to a parameter
      # typed `[System.Drawing.Bitmap]`, which throws - and it only ever happened when the game was NOT in
      # front, which is exactly why the probe failed intermittently. `Write-Host` goes to the information
      # stream and joins nothing.
      if (-not $front) { Write-Host '  WARNING: the game is not in front; this frame is not the game' }

    # RE-READ THE RECT EVERY TIME, and the saved screenshot is why: reading it once at launch aimed the
    # first version of this probe at the DESKTOP. The PNG showed a web browser with the game window's
    # corner (the CAPCOM logo) in the bottom-right, because RE3's window moves or is re-created during
    # startup - so the rect from a few seconds earlier pointed at empty desktop, and the "before" and
    # "during" samples were identical pictures of nothing.
    $live = New-Object OverlayProbe.Win32+RECT
    [void][OverlayProbe.Win32]::GetWindowRect($handle, [ref]$live)
    $origin = New-Object OverlayProbe.Win32+POINT
    $origin.X = 0
    $origin.Y = 0
    [void][OverlayProbe.Win32]::ClientToScreen($handle, [ref]$origin)

    # A ZERO-SIZED BITMAP THROWS, and that exception ends the whole run under
    # `$ErrorActionPreference = 'Stop'` - before the pipe is even connected. The client area is 0x0
    # whenever the window is not yet in a state to be measured, which is an ordinary condition rather than
    # a fault, and the screen capture is OPTIONAL: it must never be able to stop the measurement that
    # matters. That is what made the probe fail intermittently right after its foreground line.
    if ($cw -lt 8 -or $ch -lt 8) {
      Write-Host "  WARNING: the client area reads ${cw}x${ch}; skipping the screen capture"
      return $null
    }

    $bmp = New-Object System.Drawing.Bitmap($cw, $ch)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($origin.X, $origin.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    return $bmp
  }

  $before = Capture-Client
  $beforeStats = if ($null -eq $before) { @{ gold = 0; plate = 0; lit = 0; total = 0 } }
                 else { Measure-Region $before $boxX $boxY $boxW $boxH }
  if ($null -ne $before) { $before.Dispose() }
  Write-Output "  before  : gold=$($beforeStats.gold) plate=$($beforeStats.plate) lit=$($beforeStats.lit) of $($beforeStats.total)"

  # The plugin owns the pipe, named after the pid it is loaded into.
  $pipe = New-Object System.IO.Pipes.NamedPipeClientStream('.', "re-classic-overlay-$($process.Id)", 'InOut')
  $pipe.Connect(6000)
  $reader = New-Object System.IO.StreamReader($pipe)
  $writer = New-Object System.IO.StreamWriter($pipe); $writer.AutoFlush = $true
  $hello = $reader.ReadLine()
  Write-Output "  hello   : $hello"

  $writer.WriteLine("SHOW`t1`tprobe_001`tAn In-Game Toast`tDrawn over the game's own frame")
  $ack = $reader.ReadLine()
  Write-Output "  ack     : $ack"

  Start-Sleep -Milliseconds 900   # past the 300 ms fade in, inside the 3200 ms hold
  $during = Capture-Client
  $duringStats = if ($null -eq $during) { @{ gold = 0; plate = 0; lit = 0; total = 0 } }
                 else { Measure-Region $during $boxX $boxY $boxW $boxH }
  if ($null -ne $during) { $during.Dispose() }
  Write-Output "  during  : gold=$($duringStats.gold) plate=$($duringStats.plate) lit=$($duringStats.lit) of $($duringStats.total)"

  # Read UNTIL the STAT reply, rather than taking whatever line arrives next.
  #
  # The plugin answers in order, but a reader that consumes one line and prints it reports an empty
  # "stat" whenever the reply is split across reads or another line is still queued - which is what
  # several runs showed, and it hides the one number that says whether the hook fired at all.
  $writer.WriteLine('STAT')
  $stat = ''
  for ($attempt = 0; $attempt -lt 8 -and $stat -notmatch 'STAT'; $attempt++) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    if ($line -match '^STAT') { $stat = $line }
  }
  if ($stat -eq '') { $stat = '(no STAT reply)' }
  Write-Output "  stat    : $stat"

  $path = Join-Path $env:TEMP "overlay-probe-$Title.png"
  $shot = Capture-Client
  if ($null -ne $shot) {
    $shot.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $shot.Dispose()
    Write-Output "  capture : $path"
  } else {
    Write-Output '  capture : skipped (the client area was not usable)'
  }

  $goldGain = $duringStats.gold - $beforeStats.gold
  $plateGain = $duringStats.plate - $beforeStats.plate

  # THE VERDICT COMES FROM THE PLUGIN'S OWN READBACK, not from the screen capture above.
  #
  # The capture reads the *screen*, so it photographs whatever window is on top, and Windows will not let
  # a background process bring a game to the foreground - which makes it unusable as a judgement. The
  # readback reads the frame the plugin drew into and counts the design's gold; that is the measurement
  # that answers the question. The screen numbers stay printed as an illustration, and are labelled as one.
  # THE LOG FOR *THIS* RUN, by the game's pid, which is how the plugin names it.
  #
  # `-Filter '*.log' | Select-Object -First 1` picked whatever the directory happened to hold first - so
  # the "evidence" line was sometimes another run's, which is why a run that drew 113 frames reported "no
  # frame was read back": it was reading a log from an earlier process.
  $logFile = Get-ChildItem (Join-Path $env:TEMP 're-classic-overlay') -Filter "*$($process.Id).log" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  $evidence = if ($logFile) {
    [string](@(Get-Content $logFile.FullName | Where-Object { $_ -match 'readback:|patched IDirect3DDevice9' }) -join ' | ')
  } else { '(no plugin log at all)' }

  Write-Output ''
  if ($evidence -match 'readback: gold=(\d+)') {
    $gold = [int]$Matches[1]
    if ($gold -gt 0) { Write-Output "  VERDICT [$Title]: DRAWN AND VERIFIED - $gold gold pixels in the game's own frame" }
    else { Write-Output "  VERDICT [$Title]: the hook fired but the frame held no toast (gold=0)" }
  } elseif ($evidence -match 'patched IDirect3DDevice9') {
    Write-Output "  VERDICT [$Title]: the hook caught the device, but no frame was read back"
  } else {
    Write-Output "  VERDICT [$Title]: the hook MISSED the device - the game created it before the patch"
  }
  Write-Output "  evidence: $evidence"
  Write-Output "  screen  : illustration only (gold +$goldGain, plate +$plateGain); the capture reads whatever is on top"
} catch {
  # NAME THE FAILURE, because dying silently is what made this tool cost three rounds: `$ErrorActionPreference
  # = 'Stop'` turns any error into a terminating one, the `finally` below still runs (so the install is put
  # back), and the exception message went to stderr where a caller filtering stdout never saw it.
  Write-Output ''
  Write-Output "  FAILED  : $($_.Exception.GetType().Name): $($_.Exception.Message)"
  $where = [string]$_.InvocationInfo.PositionMessage
  Write-Output ("  at      : " + ($where -replace '\r?\n', ' '))
  Write-Output "  plugin log, if the game got that far: $([System.IO.Path]::GetTempPath())re-classic-overlay"
} finally {
  if ($null -ne $pipe) { $pipe.Dispose() }
  if ($process -and -not $process.HasExited) {
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    Start-Sleep -Milliseconds 800
    Write-Output "  killed  : pid $($process.Id)"
  }
  if ($null -ne $iniOriginal) {
    [System.IO.File]::WriteAllText($iniPath, $iniOriginal, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output '  config  : restored'
  }
  if (-not $probeExisted -and (Test-Path $probeDest)) {
    Remove-Item $probeDest -Force
    Write-Output '  plugin  : removed from the install'
  }
  if (-not $fontExisted -and (Test-Path $fontDest)) {
    Remove-Item $fontDest -Force
    Write-Output '  typeface: removed from the install'
  }
}
