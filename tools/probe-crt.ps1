# probe-crt.ps1 - does RetroMode / dgVoodoo scaling actually produce a CRT look?
#
# The RE-Enhance payloads ship `RetroMode = 0` in `config.ini` and name CRT-capable values
# in `dgVoodoo.conf`'s `ScalingMode` enum, but no readme in any payload says what they
# render. This measures it instead of assuming: launch the game with a given setting, grab
# the frame, and score it for *scanlines* - the one signature a CRT filter cannot avoid.
#
# The score is mean|L(y) - L(y+1)| / mean|L(y) - L(y+2)| over the frame's row means.
# Adjacent rows of an ordinary picture are much alike, so the ratio sits near 1. A
# scanline effect darkens every other row, which inflates the adjacent-row difference while
# leaving the two-apart difference alone - the ratio climbs well above 1.
#
# Usage:
#   pwsh -File tools/probe-crt.ps1 -Dir "<install>" -RetroMode 1
#   pwsh -File tools/probe-crt.ps1 -Dir "<install>" -ScalingMode stretched_4_3_crt

param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [string]$Exe = 'Biohazard.exe',
  # -1 leaves the file alone; 0/1 writes config.ini's [DLL] RetroMode.
  [int]$RetroMode = -1,
  # '' leaves the file alone; otherwise writes dgVoodoo.conf's [General] ScalingMode.
  [string]$ScalingMode = '',
  [int]$WaitSeconds = 45,
  [switch]$DismissDialog
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('CrtProbe.Win32' -as [type])) {
  Add-Type -Namespace CrtProbe -Name Win32 -MemberDefinition @'
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern IntPtr GetParent(System.IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}

$BM_CLICK = 0x00F5

function Get-Windows([int]$ProcessId) {
  $found = New-Object System.Collections.ArrayList
  $callback = [CrtProbe.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    $owner = 0
    [void][CrtProbe.Win32]::GetWindowThreadProcessId($hWnd, [ref]$owner)
    if ($owner -eq $ProcessId) {
      $class = New-Object System.Text.StringBuilder 256
      [void][CrtProbe.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][CrtProbe.Win32]::GetWindowText($hWnd, $title, 512)
      $r = New-Object CrtProbe.Win32+RECT
      [void][CrtProbe.Win32]::GetWindowRect($hWnd, [ref]$r)
      [void]$found.Add([pscustomobject]@{
          Handle = $hWnd; Class = $class.ToString(); Title = $title.ToString()
          Width = $r.Right - $r.Left; Height = $r.Bottom - $r.Top
          Visible = [CrtProbe.Win32]::IsWindowVisible($hWnd)
        })
    }
    return $true
  }
  [void][CrtProbe.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $found
}

function Get-Children([IntPtr]$Parent) {
  $children = New-Object System.Collections.ArrayList
  $callback = [CrtProbe.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ([CrtProbe.Win32]::GetParent($hWnd) -eq $Parent) {
      $class = New-Object System.Text.StringBuilder 256
      [void][CrtProbe.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][CrtProbe.Win32]::GetWindowText($hWnd, $title, 512)
      [void]$children.Add([pscustomobject]@{ Handle = $hWnd; Class = $class.ToString(); Title = $title.ToString() })
    }
    return $true
  }
  [void][CrtProbe.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $children
}

# --- patch the two files, remembering exactly what was there -----------------

$iniPath = Join-Path $Dir 'config.ini'
$dgPath = Join-Path $Dir 'dgVoodoo.conf'
$iniOriginal = if (Test-Path $iniPath) { [System.IO.File]::ReadAllText($iniPath) } else { $null }
$dgOriginal = if (Test-Path $dgPath) { [System.IO.File]::ReadAllText($dgPath) } else { $null }

if ($RetroMode -ge 0) {
  if ($null -eq $iniOriginal) { throw "no config.ini in $Dir - inject RE-Enhance first" }
  $patched = [regex]::Replace($iniOriginal, '(?m)^(\s*RetroMode\s*=\s*).*$', "`${1}$RetroMode")
  if ($patched -notmatch '(?m)^\s*RetroMode\s*=') { $patched = $iniOriginal }
  [System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "config.ini    RetroMode = $RetroMode"
}

# `BootConfig = 0` is what the launcher itself writes before every launch to suppress
# RE-Enhance's CONFIGURATION dialog. Without it the probe stops on that dialog and never
# reaches a frame, which is exactly what the first version of this script did.
if ($null -ne $iniOriginal) {
  $current = [System.IO.File]::ReadAllText($iniPath)
  $patched = [regex]::Replace($current, '(?m)^(\s*BootConfig\s*=\s*).*$', '${1}0')
  if ($patched -ne $current) {
    [System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
  }
  Write-Output "config.ini    BootConfig = 0 (as the launcher writes it)"
}
if ($ScalingMode -ne '') {
  if ($null -eq $dgOriginal) { throw "no dgVoodoo.conf in $Dir - this title has no dgVoodoo wrapper" }
  $patched = [regex]::Replace($dgOriginal, '(?m)^(\s*ScalingMode\s*=\s*).*$', "`${1}$ScalingMode")
  [System.IO.File]::WriteAllText($dgPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "dgVoodoo.conf ScalingMode = $ScalingMode"
}

$process = $null
try {
  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "launched $Exe (pid $($process.Id))"

  # The loader's MOD SELECTION dialog, if this payload has one.
  $dismissed = $false
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $game = $null
  while ((Get-Date) -lt $deadline -and $null -eq $game) {
    Start-Sleep -Milliseconds 400
    $process.Refresh()
    if ($process.HasExited) { break }
    $windows = @(Get-Windows -ProcessId $process.Id)
    $dialog = $windows | Where-Object { $_.Visible -and $_.Class -eq '#32770' } | Select-Object -First 1
    if ($null -ne $dialog -and -not $dismissed -and $DismissDialog) {
      Write-Output "  loader dialog: '$($dialog.Title)'"
      $clicked = $false
      foreach ($child in Get-Children -Parent $dialog.Handle) {
        if ($child.Class -ne 'Button') { continue }
        $label = $child.Title -replace '&', ''
        if ($label -match '^(OK|Ok|Start|Play|Yes|決定|はい)$') {
          [void][CrtProbe.Win32]::SendMessage($child.Handle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
          Write-Output "  clicked '$label'"
          $clicked = $true
          break
        }
      }
      if (-not $clicked) {
        [void][CrtProbe.Win32]::SetForegroundWindow($dialog.Handle)
        Start-Sleep -Milliseconds 300
        [void][CrtProbe.Win32]::PostMessage($dialog.Handle, 0x0100, [IntPtr]13, [IntPtr]::Zero)
        [void][CrtProbe.Win32]::PostMessage($dialog.Handle, 0x0101, [IntPtr]13, [IntPtr]::Zero)
        Write-Output '  posted Enter to the dialog'
      }
      $dismissed = $true
    }
    $game = $windows | Where-Object { $_.Visible -and $_.Class -ne '#32770' -and $_.Width -gt 200 } |
      Sort-Object { $_.Width * $_.Height } -Descending | Select-Object -First 1
  }

  if ($process.HasExited) {
    Write-Output "RESULT: the game exited on its own (code $($process.ExitCode)) before rendering a frame"
    return
  }
  if ($null -eq $game) {
    Write-Output "RESULT: no game window appeared within $WaitSeconds s"
    return
  }

  Write-Output "  game window: class=$($game.Class) '$($game.Title)' $($game.Width)x$($game.Height)"
  [void][CrtProbe.Win32]::SetForegroundWindow($game.Handle)

  # Let it get past its intro logos. A scanline effect is multiplicative: on a black frame
  # it is invisible, and the opening movie is mostly black (measured: mean 28/255). So
  # several frames are sampled and the *brightest* is scored - the one with the most
  # content to be darkened.
  $best = $null
  $bestMean = -1
  for ($sample = 0; $sample -lt 10; $sample++) {
    Start-Sleep -Seconds 4
    $rect = New-Object CrtProbe.Win32+RECT
    [void][CrtProbe.Win32]::GetClientRect($game.Handle, [ref]$rect)
    $windowRect = New-Object CrtProbe.Win32+RECT
    [void][CrtProbe.Win32]::GetWindowRect($game.Handle, [ref]$windowRect)
    $captureW = [Math]::Min($rect.Right, 1200)
    $captureH = [Math]::Min($rect.Bottom, 900)
    if ($captureW -lt 32 -or $captureH -lt 32) { continue }

    $bmp = New-Object System.Drawing.Bitmap($captureW, $captureH)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($windowRect.Left, $windowRect.Top, 0, 0, $bmp.Size)
    $g.Dispose()

    $rowMean = New-Object 'double[]' $captureH
    for ($y = 0; $y -lt $captureH; $y++) {
      $sum = 0.0
      for ($x = 0; $x -lt $captureW; $x += 4) {
        $p = $bmp.GetPixel($x, $y)
        $sum += 0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B
      }
      $rowMean[$y] = $sum / [Math]::Ceiling($captureW / 4.0)
    }
    $bmp.Dispose()

    $mean = ($rowMean | Measure-Object -Average).Average
    if ($mean -gt $bestMean) { $bestMean = $mean; $best = $rowMean }
  }

  if ($null -eq $best) { Write-Output 'RESULT: no usable frame was captured'; return }
  $captureH = $best.Count
  $rowMean = $best

  $adjacent = 0.0; $skip = 0.0
  for ($y = 0; $y -lt $captureH - 2; $y++) {
    $adjacent += [Math]::Abs($rowMean[$y] - $rowMean[$y + 1])
    $skip += [Math]::Abs($rowMean[$y] - $rowMean[$y + 2])
  }
  $adjacent /= ($captureH - 2); $skip /= ($captureH - 2)
  $overall = ($rowMean | Measure-Object -Average).Average
  $score = if ($skip -lt 0.001) { 0 } else { [Math]::Round($adjacent / $skip, 2) }

  Write-Output ""
  Write-Output "=== frame statistics (brightest of 10 samples, $captureH rows) ==="
  "  mean luminance        = $([Math]::Round($overall,1)) / 255"
  "  adjacent-row diff     = $([Math]::Round($adjacent,2))"
  "  two-apart-row diff    = $([Math]::Round($skip,2))"
  "  scanline score        = $score   (near 1 = none, well above 1 = alternating rows)"
  Write-Output ""
  if ($overall -lt 6) {
    Write-Output "RESULT: the frame is essentially black - nothing to score"
  } elseif ($score -gt 1.6) {
    Write-Output "RESULT: SCANLINES PRESENT (score $score)"
  } else {
    Write-Output "RESULT: no scanline signature (score $score)"
  }
} finally {
  if ($process -and -not $process.HasExited) {
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    Write-Output "killed pid $($process.Id)"
  }
  if ($null -ne $iniOriginal) { [System.IO.File]::WriteAllText($iniPath, $iniOriginal, (New-Object System.Text.UTF8Encoding($false))) }
  if ($null -ne $dgOriginal) { [System.IO.File]::WriteAllText($dgPath, $dgOriginal, (New-Object System.Text.UTF8Encoding($false))) }
  Write-Output "restored config.ini and dgVoodoo.conf"
}
