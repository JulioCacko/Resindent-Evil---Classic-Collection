# gate-run.ps1 - Phase 0 of the in-game overlay: measure, do not assume.
#
# The overlay is delivered as an ASI plugin, and three things about that are currently
# beliefs rather than observations:
#
#   1. that the `dinput8.dll` / `dsound.dll` in these installs (which identify themselves
#      as "Ultimate-ASI-Loader-x86") really does load a `*.asi` the launcher puts there;
#   2. what the presentation chain is in the *running* process, with module paths - the
#      static reading says RE1/RE2 reach D3D11 through dgVoodoo while RE3 imports d3d9
#      directly, and only the live process can confirm which modules are actually mapped;
#   3. that the game is presenting frames at all while the plugin sits inside it, which is
#      what makes a present hook worth writing.
#
# So this runs a title the way the launcher does, with the measurement-only probe plugin
# (`native/_gate/gate.cpp`, which hooks nothing) installed beside the game, samples the
# screen to prove frames are being drawn, and then puts the install back exactly as it was.
#
# It leaves nothing behind: the probe file is removed, `config.ini` is restored byte for
# byte, and the probe's own logs live in `%TEMP%\re-overlay-gate\`.
#
# Usage:
#   pwsh -File tools/gate-run.ps1 -Title RE1 -Dir "GOG Games\Resident Evil" -Exe Biohazard.exe
#   pwsh -File tools/gate-run.ps1 -Title RE2 -Dir "GOG Games\Resident Evil 2" -Exe RE2Launcher.exe
#   pwsh -File tools/gate-run.ps1 -Title RE3 -Dir "GOG Games\Resident Evil 3" -Exe "BIOHAZARD(R) 3 PC.exe"

param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Probe = '',
  [string]$DialogStrategy = 'down-enter',
  [int]$WaitSeconds = 75,
  [int]$SampleSeconds = 20,
  [string]$SaveFrame = '',
  [switch]$KeepProbe,
  [switch]$LeaveWindowed
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $repoRoot 'resources\window-host.ps1'
$logDir = Join-Path ([System.IO.Path]::GetTempPath()) 're-overlay-gate'

if ($Probe -eq '') { $Probe = Join-Path $repoRoot 'native\_gate\re_overlay_gate.asi' }
if (-not (Test-Path $Probe)) { throw "the gate probe was not found at $Probe - run: node tools/build-native.mjs" }
if (-not (Test-Path (Join-Path $Dir $Exe))) { throw "no $Exe in $Dir" }

Add-Type -AssemblyName System.Drawing
if (-not ('GateRun.Win32' -as [type])) {
  Add-Type -Namespace GateRun -Name Win32 -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr hWnd, System.IntPtr hdcBlt, uint nFlags);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
'@
}

$VK_RETURN = 13
$VK_DOWN = 40
$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101

# --- reading a captured frame -------------------------------------------------------
#
# `LockBits` + `Marshal.Copy` rather than `GetPixel` per sample point: the first version of
# this probe read a 12x12 grid, and a sparse grid cannot tell two near-black frames apart,
# which is precisely the case RE1's opening presents. Copying the whole buffer once turns
# that into a hash over every pixel for the cost of one native call.

function Get-FrameBytes([System.Drawing.Bitmap]$Bitmap) {
  $rect = New-Object System.Drawing.Rectangle(0, 0, $Bitmap.Width, $Bitmap.Height)
  $data = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $length = [Math]::Abs($data.Stride) * $Bitmap.Height
    $buffer = New-Object byte[] $length
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buffer, 0, $length)
    # The leading comma keeps PowerShell from unrolling the array into the output stream.
    return , $buffer
  } finally {
    $Bitmap.UnlockBits($data)
  }
}

# SHA-256 over the whole frame: maximum sensitivity, native speed.
function Get-FrameSignature([System.Drawing.Bitmap]$Bitmap) {
  $bytes = Get-FrameBytes $Bitmap
  $hash = [System.Security.Cryptography.SHA256]::HashData([byte[]]$bytes)
  return [System.Convert]::ToHexString($hash).Substring(0, 16)
}

# Mean luminance, and the fraction of pixels that are not essentially black.
#
# Stepped by 64 bytes (one sample per 16 pixels, BGRA order) so the scan stays a fraction
# of a second in PowerShell while still covering the whole frame rather than a 144-point
# grid.
function Get-FrameStats([System.Drawing.Bitmap]$Bitmap) {
  $bytes = Get-FrameBytes $Bitmap
  $sum = 0.0
  $lit = 0
  $count = 0
  for ($i = 0; $i + 2 -lt $bytes.Length; $i += 64) {
    $luminance = 0.114 * $bytes[$i] + 0.587 * $bytes[$i + 1] + 0.299 * $bytes[$i + 2]
    $sum += $luminance
    if ($luminance -gt 8) { $lit++ }
    $count++
  }
  if ($count -eq 0) { return @{ mean = 0.0; lit = 0.0 } }
  return @{ mean = $sum / $count; lit = $lit / $count }
}

function Convert-Handle([string]$Handle) {
  return [IntPtr][Convert]::ToInt64($Handle.Substring(2), 16)
}

# The shipped helper is the enumeration path here too, so the probe and the launcher ask
# the same question the same way (tools/probe-place.ps1 states the same rule: a probe with
# its own implementation can pass while the thing that ships is broken).
function Get-Windows([int]$ProcessId) {
  $json = & pwsh -NoProfile -File $helper -Action query -ProcessId $ProcessId 2>$null | Select-Object -Last 1
  if ($null -eq $json -or $json -eq '') { return @() }
  try { return @(($json | ConvertFrom-Json).windows) } catch { return @() }
}

# RE2 and RE3 are started through a file literally named "Launcher", so the game window may
# belong to a child process; the tree is walked rather than assumed to be one pid.
function Get-ProcessTree([int]$Root) {
  $seen = New-Object System.Collections.Generic.List[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($Root)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($seen.Contains($current)) { continue }
    $seen.Add($current)
    try {
      $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$current" -ErrorAction SilentlyContinue
      foreach ($child in @($children)) { $queue.Enqueue([int]$child.ProcessId) }
    } catch { }
  }
  return @($seen)
}

function Answer-Dialog([string]$Handle, [string]$Title2) {
  $raw = Convert-Handle $Handle
  [void][GateRun.Win32]::SetForegroundWindow($raw)
  Start-Sleep -Milliseconds 400
  if ($DialogStrategy -eq 'down-enter') {
    [void][GateRun.Win32]::PostMessage($raw, $WM_KEYDOWN, [IntPtr]$VK_DOWN, [IntPtr]::Zero)
    [void][GateRun.Win32]::PostMessage($raw, $WM_KEYUP, [IntPtr]$VK_DOWN, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 250
  }
  [void][GateRun.Win32]::PostMessage($raw, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
  [void][GateRun.Win32]::PostMessage($raw, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
  Write-Output "    answered the '$Title2' dialog with $DialogStrategy"
}

# ---------------------------------------------------------------- install the probe

$probeName = Split-Path -Leaf $Probe
$probeDest = Join-Path $Dir $probeName
$probeExisted = Test-Path $probeDest

$iniPath = Join-Path $Dir 'config.ini'
$iniOriginal = if (Test-Path $iniPath) { [System.IO.File]::ReadAllText($iniPath) } else { $null }

$logsBefore = @()
if (Test-Path $logDir) { $logsBefore = @(Get-ChildItem $logDir -File | ForEach-Object { $_.Name }) }

$process = $null
$windowedPatched = $false
try {
  Write-Output "=== $Title ==="
  Write-Output "  install : $Dir\$Exe"
  Write-Output "  probe   : $probeName -> $probeDest (existed before: $probeExisted)"

  Copy-Item -Path $Probe -Destination $probeDest -Force

  # Windowed mode. Exclusive fullscreen cannot be screen-captured, and a fullscreen
  # swapchain would also invalidate the present-hook question by changing the answer, so
  # the gate runs in the mode the overlay is actually meant for. Restored at the end.
  if ($null -ne $iniOriginal -and -not $LeaveWindowed) {
    $patched = $iniOriginal -replace '(?m)^(FullScreen\?\s*=\s*).*$', '${1}0'
    $patched = $patched -replace '(?m)^(BootConfig\s*=\s*).*$', '${1}0'
    if ($patched -ne $iniOriginal) {
      [System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
      $windowedPatched = $true
      Write-Output "  config.ini: FullScreen?/BootConfig set to 0 (windowed)"
    } else {
      Write-Output "  config.ini: no FullScreen?/BootConfig key to set"
    }
  }

  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "  launched $Exe (pid $($process.Id))"

  # --- find the game window, answering the loader's dialogs on the way -----------------
  $answered = @{}
  $game = $null
  $gameOwner = 0
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $stableFor = 0
  $lastHandle = ''
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) { break }

    $tree = Get-ProcessTree -Root $process.Id
    $all = @()
    foreach ($pid2 in $tree) { $all += @(Get-Windows -ProcessId $pid2) }

    # Only the LOADER's dialog is answered, and it is identified by its title and its size
    # rather than by its class.
    #
    # Measured on RE1: the game's own main window is *also* class #32770 — a dialog titled
    # "RESIDENT EVIL® PC" — so answering every #32770 with Down+Enter walks the game's own
    # menu and quits it. That is exactly what the first run of this probe did, which is why
    # the rule below is narrow: a small dialog whose title mentions the mod selection.
    foreach ($dialog in @($all | Where-Object {
          $_.visible -and $_.class -eq '#32770' -and $_.width -lt 800 -and $_.height -lt 600 -and $_.title -match '(?i)mod'
        })) {
      if (-not $answered.ContainsKey($dialog.handle)) {
        Answer-Dialog -Handle $dialog.handle -Title2 $dialog.title
        $answered[$dialog.handle] = $true
        Start-Sleep -Seconds 2
      }
    }

    # The game window, by size and visibility only: its class is not a reliable marker for
    # these titles, and the loader's dialogs are too small to be mistaken for it.
    $candidate = @($all | Where-Object { $_.visible -and $_.width -gt 400 -and $_.height -gt 300 } |
      Sort-Object { $_.width * $_.height } -Descending) | Select-Object -First 1
    if ($null -ne $candidate) {
      if ($candidate.handle -eq $lastHandle) { $stableFor += 1 } else { $stableFor = 0 }
      $lastHandle = $candidate.handle
      if ($stableFor -ge 2) { $game = $candidate; break }
    }
  }

  if ($process.HasExited -and $null -eq $game) {
    Write-Output "  RESULT [$Title]: the game exited on its own (code $($process.ExitCode)) - no window, no measurement"
    return
  }
  if ($null -eq $game) {
    Write-Output "  RESULT [$Title]: no stable game window within $WaitSeconds s"
    return
  }

  $handle = Convert-Handle $game.handle
  $windowRect = New-Object GateRun.Win32+RECT
  [void][GateRun.Win32]::GetWindowRect($handle, [ref]$windowRect)
  $clientRect = New-Object GateRun.Win32+RECT
  [void][GateRun.Win32]::GetClientRect($handle, [ref]$clientRect)

  Write-Output "  window  : class=$($game.class) '$($game.title)' $($game.width)x$($game.height) at $($windowRect.Left),$($windowRect.Top) client=$($clientRect.Right)x$($clientRect.Bottom)"

  # Bring the game forward, and CHECK that it took.
  #
  # The first version of this probe did not check, and the failure mode is silent and
  # instructive: sampling the screen while the terminal that runs this script is still in
  # front measures the terminal. A static console gives a static "frame", and the gate
  # would have reported "no presentation observed" about a game that was drawing perfectly
  # well behind it. So the foreground window is verified at every sample below, and the
  # capture itself does not depend on it (see PrintWindow).
  [void][GateRun.Win32]::ShowWindow($handle, 9)   # SW_RESTORE
  [void][GateRun.Win32]::BringWindowToTop($handle)
  [void][GateRun.Win32]::SetForegroundWindow($handle)
  Start-Sleep -Seconds 3
  $foreground = [GateRun.Win32]::GetForegroundWindow()
  Write-Output "  foreground: game is in front: $($foreground -eq $handle)"

  # --- is it presenting? ---------------------------------------------------------------
  #
  # Two capture paths, and the difference between them is itself a measurement:
  #
  #   PrintWindow(..., PW_RENDERFULLCONTENT) - the window's own content, occluded or not.
  #       MEASURED HERE: it returns a pure black image for this game's dgVoodoo/D3D11
  #       window, so it is attempted for the record and not relied on.
  #   CopyFromScreen - the screen at the window's coordinates, which is the only path that
  #       sees what the player sees. It requires the game to be in front, so that is checked
  #       at every sample instead of assumed: the first version of this probe did not check,
  #       and a static console in front produces a perfectly static "frame".
  #
  # The frame signature is a hash of EVERY captured pixel through LockBits, not a sparse
  # grid. A 12x12 grid was the first version's mistake: on RE1's near-black opening it can
  # be identical between two genuinely different frames, which reads as "not presenting".
  $captureW = $windowRect.Right - $windowRect.Left
  $captureH = $windowRect.Bottom - $windowRect.Top
  if ($captureW -lt 64 -or $captureH -lt 64) { $captureW = $clientRect.Right; $captureH = $clientRect.Bottom }
  if ($captureW -lt 64 -or $captureH -lt 64) {
    Write-Output "  RESULT [$Title]: the window is too small to sample ($captureW x $captureH)"
    return
  }

  $signatures = New-Object System.Collections.Generic.List[string]
  $means = New-Object System.Collections.Generic.List[double]
  $litFraction = New-Object System.Collections.Generic.List[double]
  $captureFailures = 0
  $behindForeground = 0
  $printWindowBlack = 0
  $printWindowWorked = 0

  for ($sample = 0; $sample -lt $SampleSeconds; $sample++) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) { break }
    if ([GateRun.Win32]::GetForegroundWindow() -ne $handle) { $behindForeground++ }

    try {
      $bmp = New-Object System.Drawing.Bitmap($captureW, $captureH)
      $graphics = [System.Drawing.Graphics]::FromImage($bmp)

      # Try the window's own content first, and fall back to the screen whenever it comes
      # back black - which is every frame for this title.
      $graphics.Clear([System.Drawing.Color]::Black)
      $hdc = $graphics.GetHdc()
      $drawn = [GateRun.Win32]::PrintWindow($handle, $hdc, 2)
      $graphics.ReleaseHdc($hdc)

      $stats = Get-FrameStats $bmp
      if ($drawn -and $stats.mean -gt 0.5) {
        $printWindowWorked++
        $mean = $stats.mean
        $lit = $stats.lit
      } else {
        if ($drawn) { $printWindowBlack++ }
        $graphics.CopyFromScreen($windowRect.Left, $windowRect.Top, 0, 0, $bmp.Size)
        $stats = Get-FrameStats $bmp
        $mean = $stats.mean
        $lit = $stats.lit
      }
      $graphics.Dispose()

      [void]$signatures.Add((Get-FrameSignature $bmp))
      [void]$means.Add($mean)
      [void]$litFraction.Add($lit)

      # Optional evidence, for a human to look at: the sampled frame and the whole screen.
      # A static frame raises a question a number cannot answer — what is actually in the
      # window? — and the answer changes what the measurement means.
      if ($SaveFrame -ne '' -and $sample -eq ($SampleSeconds - 1)) {
        $target = Join-Path $SaveFrame "$Title-window.png"
        $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        # The whole virtual screen, so the frame above can be read in the context it was
        # captured in (is the game in front? is anything else over it?).
        $left = [GateRun.Win32]::GetSystemMetrics(76)   # SM_XVIRTUALSCREEN
        $top = [GateRun.Win32]::GetSystemMetrics(77)    # SM_YVIRTUALSCREEN
        $wide = [GateRun.Win32]::GetSystemMetrics(78)   # SM_CXVIRTUALSCREEN
        $tall = [GateRun.Win32]::GetSystemMetrics(79)   # SM_CYVIRTUALSCREEN
        $full = New-Object System.Drawing.Bitmap($wide, $tall)
        $fullGraphics = [System.Drawing.Graphics]::FromImage($full)
        $fullGraphics.CopyFromScreen($left, $top, 0, 0, $full.Size)
        $fullGraphics.Dispose()
        $full.Save((Join-Path $SaveFrame "$Title-screen.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $full.Dispose()
        Write-Output "  saved     : $Title-window.png and $Title-screen.png in $SaveFrame"
      }

      $bmp.Dispose()
    } catch {
      $captureFailures++
    }
  }

  $distinct = @($signatures | Sort-Object -Unique).Count
  $minMean = if ($means.Count -gt 0) { [Math]::Round(($means | Measure-Object -Minimum).Minimum, 2) } else { -1 }
  $maxMean = if ($means.Count -gt 0) { [Math]::Round(($means | Measure-Object -Maximum).Maximum, 2) } else { -1 }
  $avgMean = if ($means.Count -gt 0) { [Math]::Round(($means | Measure-Object -Average).Average, 2) } else { -1 }
  $maxLit = if ($litFraction.Count -gt 0) { [Math]::Round(($litFraction | Measure-Object -Maximum).Maximum * 100, 2) } else { -1 }

  Write-Output ""
  Write-Output "  --- presenting ---"
  Write-Output "  samples              : $($signatures.Count) of $SampleSeconds (capture failures: $captureFailures)"
  Write-Output "  frames distinct      : $distinct  (a hash of every pixel)"
  Write-Output "  luminance min/avg/max: $minMean / $avgMean / $maxMean of 255"
  Write-Output "  lit pixels, peak     : $maxLit % of the frame above luminance 8"
  Write-Output "  PrintWindow          : usable $printWindowWorked, black $printWindowBlack of $($signatures.Count)"
  Write-Output "  game behind another window: $behindForeground of $($signatures.Count)"

  $presenting = $distinct -gt 1
  $captured = $maxMean -gt 1.0
  if ($captured -and $presenting) { Write-Output "  VERDICT: the game is presenting frames a capture can see" }
  elseif (-not $captured) { Write-Output "  VERDICT: the capture read back (near) black - neither path sees this window's content" }
  else { Write-Output "  VERDICT: the frame did not change over $SampleSeconds s - no presentation observed" }
} finally {
  if ($process -and -not $process.HasExited) {
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    Start-Sleep -Seconds 1
    Write-Output "  killed pid $($process.Id) and its tree"
  }

  if ($windowedPatched -and $null -ne $iniOriginal) {
    [System.IO.File]::WriteAllText($iniPath, $iniOriginal, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output '  config.ini restored'
  }

  if (-not $KeepProbe) {
    if (-not $probeExisted -and (Test-Path $probeDest)) {
      Remove-Item $probeDest -Force
      Write-Output '  probe removed from the install'
    } elseif ($probeExisted) {
      Write-Output "  probe left in place: it was already there before this run"
    }
  } else {
    Write-Output "  probe left in place at $probeDest (-KeepProbe)"
  }
}

# ------------------------------------------------------------- the probe's own logs

Write-Output ""
Write-Output "  --- the plugin's own report ---"
if (-not (Test-Path $logDir)) {
  Write-Output "  NO LOG DIRECTORY: the plugin never ran in this process."
  Write-Output "  GATE_RESULT $([System.Text.Json.JsonSerializer]::Serialize(@{ title = $Title; loaded = $false }))"
  return
}

$newLogs = @(Get-ChildItem $logDir -File | Where-Object { $logsBefore -notcontains $_.Name })
if ($newLogs.Count -eq 0) {
  Write-Output "  NO NEW LOG FILES: the ASI loader did not load the probe in this process."
  Write-Output "  GATE_RESULT $([System.Text.Json.JsonSerializer]::Serialize(@{ title = $Title; loaded = $false }))"
  return
}

foreach ($log in ($newLogs | Sort-Object Name)) {
  Write-Output ""
  Write-Output "  [$($log.Name)]"
  Get-Content $log.FullName | Select-Object -First 60 | ForEach-Object { "    $_" }
  $lines = @(Get-Content $log.FullName).Count
  if ($lines -gt 60) { Write-Output "    ... $($lines - 60) more lines" }
}
