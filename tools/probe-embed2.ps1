# probe-embed2.ps1 - can the GAME's window be reparented into a host window?
#
# The first probe answered "no" and this one exists because that answer deserves a second look. Its
# own premise was that the games run in DirectDraw exclusive fullscreen, which cannot be reparented at
# all - and the install ships `FullScreen? = 1`, so it tested the one case that is impossible by
# design. Run against the same game *windowed*, it reported `IsWindow = False` on the handle it was
# about to reparent, which means the window it targeted was already gone: RE-Enhance's loader exits
# and the game creates a *new* window, so a handle captured a second earlier is stale. A stale handle
# produces exactly the same verdict as an un-reparentable window, and the difference decides whether
# this can work.
#
# So this probe is disciplined about the handle:
#
#   1. force the game windowed (`FullScreen? = 0`) and restore the file afterwards;
#   2. find the largest visible non-dialog window the game's process owns;
#   3. require that handle to survive 1.5s and pass `IsWindow` *immediately* before touching it;
#   4. only then apply the style surgery (`WS_CHILD`, minus `WS_POPUP`/`WS_CAPTION`), `SetParent`,
#      `MoveWindow`, and report every return value and `GetLastError`;
#   5. measure whether anything is still drawn: the host is painted magenta, and magenta surviving
#      means the wrapper stopped presenting.
#
# Usage:
#   pwsh -File tools/probe-embed2.ps1 -Dir "<install>" -Exe Biohazard.exe

param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Exe,
  [int]$WaitSeconds = 40,
  [int]$HostWidth = 1300,
  [int]$HostHeight = 975,
  [int]$SampleSeconds = 8
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('Embed2.Win32' -as [type])) {
  Add-Type -Namespace Embed2 -Name Win32 -MemberDefinition @'
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern IntPtr GetParent(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool PostMessage(IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}

$GWL_STYLE = -16
$WS_CHILD = 0x40000000
$WS_POPUP = 0x80000000
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$BM_CLICK = 0x00F5

function Get-ProcessWindows([int]$ProcessId) {
  $found = New-Object System.Collections.ArrayList
  $callback = [Embed2.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    $owner = 0
    [void][Embed2.Win32]::GetWindowThreadProcessId($hWnd, [ref]$owner)
    if ($owner -eq $ProcessId) {
      $class = New-Object System.Text.StringBuilder 256
      [void][Embed2.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][Embed2.Win32]::GetWindowText($hWnd, $title, 512)
      $r = New-Object Embed2.Win32+RECT
      [void][Embed2.Win32]::GetWindowRect($hWnd, [ref]$r)
      [void]$found.Add([pscustomobject]@{
          Handle = $hWnd
          Class = $class.ToString()
          Title = $title.ToString()
          Width = $r.Right - $r.Left
          Height = $r.Bottom - $r.Top
          Style = [Embed2.Win32]::GetWindowLong($hWnd, $GWL_STYLE)
          Visible = [Embed2.Win32]::IsWindowVisible($hWnd)
        })
    }
    return $true
  }
  [void][Embed2.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $found
}

function Get-Children([IntPtr]$Parent) {
  $children = New-Object System.Collections.ArrayList
  $callback = [Embed2.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ([Embed2.Win32]::GetParent($hWnd) -eq $Parent) {
      $class = New-Object System.Text.StringBuilder 256
      [void][Embed2.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][Embed2.Win32]::GetWindowText($hWnd, $title, 512)
      [void]$children.Add([pscustomobject]@{ Handle = $hWnd; Class = $class.ToString(); Title = $title.ToString() })
    }
    return $true
  }
  [void][Embed2.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $children
}

function Describe([IntPtr]$Handle) {
  if (-not [Embed2.Win32]::IsWindow($Handle)) { return 'handle is not a window any more' }
  $class = New-Object System.Text.StringBuilder 256
  [void][Embed2.Win32]::GetClassName($Handle, $class, 256)
  $title = New-Object System.Text.StringBuilder 512
  [void][Embed2.Win32]::GetWindowText($Handle, $title, 512)
  $r = New-Object Embed2.Win32+RECT
  [void][Embed2.Win32]::GetWindowRect($Handle, [ref]$r)
  $style = [Embed2.Win32]::GetWindowLong($Handle, $GWL_STYLE)
  return "class=$($class.ToString()) title='$($title.ToString())' $($r.Right - $r.Left)x$($r.Bottom - $r.Top) style=0x$('{0:X8}' -f $style) parent=0x$('{0:X}' -f ([Embed2.Win32]::GetParent($Handle)).ToInt64())"
}

# --- force windowed mode, remembering the file exactly ------------------------

$iniPath = Join-Path $Dir 'config.ini'
$iniOriginal = if (Test-Path $iniPath) { [System.IO.File]::ReadAllText($iniPath) } else { $null }
if ($null -eq $iniOriginal) { throw "no config.ini in $Dir - inject RE-Enhance first" }
$patched = $iniOriginal -replace '(?m)^(FullScreen\?\s*=\s*).*$', '${1}0'
# `BootConfig = 0` as well, exactly as the launcher writes it before every launch. The game rewrites
# its own config on exit, so by the time a probe runs the wrapper is asking its CONFIGURATION question
# again - and a probe that stops on that dialog measures nothing. (The CRT probe lost a run to this
# same thing.)
$patched = $patched -replace '(?m)^(BootConfig\s*=\s*).*$', '${1}0'
[System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'config.ini: FullScreen? = 0 (windowed) and BootConfig = 0 (no wrapper dialog)'

$process = $null
try {
  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "launched $Exe (pid $($process.Id))"

  $dismissed = $false
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $target = $null
  $stableFor = 0
  $lastHandle = [IntPtr]::Zero

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { break }
    $windows = @(Get-ProcessWindows -ProcessId $process.Id)

    $dialog = $windows | Where-Object { $_.Visible -and $_.Class -eq '#32770' } | Select-Object -First 1
    if ($null -ne $dialog -and -not $dismissed) {
      $controls = @(Get-Children -Parent $dialog.Handle)
      Write-Output "  dialog '$($dialog.Title)' has $($controls.Count) controls:"
      foreach ($control in $controls) {
        Write-Output "    $($control.Class) '$($control.Title)'"
      }
      $clicked = $false
      foreach ($child in $controls) {
        if ($child.Class -ne 'Button') { continue }
        [void][Embed2.Win32]::SendMessage($child.Handle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
        Write-Output "    clicked '$($child.Title)'"
        $clicked = $true
        break
      }
      if (-not $clicked) {
        [void][Embed2.Win32]::SendMessage($dialog.Handle, 0x0100, [IntPtr]13, [IntPtr]::Zero)
        [void][Embed2.Win32]::SendMessage($dialog.Handle, 0x0101, [IntPtr]13, [IntPtr]::Zero)
      }
      Write-Output "  dismissed the loader dialog '$($dialog.Title)'"
      $dismissed = $true
    }

    $candidate = @($windows | Where-Object { $_.Visible -and $_.Class -ne '#32770' -and $_.Width -gt 200 -and $_.Height -gt 200 } |
      Sort-Object { $_.Width * $_.Height } -Descending) | Select-Object -First 1

    if ($null -ne $candidate) {
      # A handle that changes between two reads is a window the game is still re-creating.
      if ($candidate.Handle -eq $lastHandle) { $stableFor += 500 } else { $stableFor = 0 }
      $lastHandle = $candidate.Handle
      if ($stableFor -ge 1500) { $target = $candidate; break }
    }
  }

  if ($process.HasExited) {
    Write-Output "RESULT: the game exited on its own (code $($process.ExitCode)) before showing a window"
    return
  }
  if ($null -eq $target) {
    Write-Output "RESULT: no game window stayed alive long enough to be a target in $WaitSeconds s"
    return
  }

  Write-Output ''
  Write-Output '=== target: stable for 1.5s, and re-checked immediately before the attempt ==='
  Write-Output "  $($target.Handle.ToInt64())  $(Describe $target.Handle)"

  # Bring it forward so the host form is a real sibling in z-order, not behind the desktop.
  [void][Embed2.Win32]::SetForegroundWindow($target.Handle)
  Start-Sleep -Milliseconds 400
  if (-not [Embed2.Win32]::IsWindow($target.Handle)) {
    Write-Output 'RESULT: the handle died between the check and the attempt - the game re-creates its window under us'
    return
  }

  $hostForm = New-Object System.Windows.Forms.Form
  $hostForm.Text = 'embed host'
  $hostForm.FormBorderStyle = 'None'
  $hostForm.StartPosition = 'Manual'
  $hostForm.Location = New-Object System.Drawing.Point(1150, 420)
  $hostForm.ClientSize = New-Object System.Drawing.Size($HostWidth, $HostHeight)
  $hostForm.BackColor = [System.Drawing.Color]::Magenta
  $hostForm.TopMost = $true
  $hostForm.Show()
  [System.Windows.Forms.Application]::DoEvents()
  Write-Output "  host form 0x$('{0:X}' -f $hostForm.Handle.ToInt64())  ${HostWidth}x${HostHeight} at 1150,420"

  $styleBefore = [Embed2.Win32]::GetWindowLong($target.Handle, $GWL_STYLE)
  $childStyle = ($styleBefore -bor $WS_CHILD) -band (-bnot $WS_POPUP) -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)
  [void][Embed2.Win32]::SetWindowLong($target.Handle, $GWL_STYLE, $childStyle)
  [System.Windows.Forms.Application]::DoEvents()

  $setParentResult = [Embed2.Win32]::SetParent($target.Handle, $hostForm.Handle)
  $error = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Output ''
  Write-Output '=== after the style surgery and SetParent ==='
  Write-Output "  SetWindowLong: 0x$('{0:X8}' -f $styleBefore) -> 0x$('{0:X8}' -f ([Embed2.Win32]::GetWindowLong($target.Handle, $GWL_STYLE)))"
  Write-Output "  SetParent returned: 0x$('{0:X}' -f $setParentResult.ToInt64())   GetLastError: $error"
  Write-Output "  immediately: $(Describe $target.Handle)"

  if ([Embed2.Win32]::IsWindow($target.Handle)) {
    [void][Embed2.Win32]::MoveWindow($target.Handle, 0, 0, $HostWidth, $HostHeight, $true)
    [System.Windows.Forms.Application]::DoEvents()
  }
  Start-Sleep -Seconds 3
  Write-Output "  after 3s:    $(Describe $target.Handle)"
  Write-Output "  host parent: 0x$('{0:X}' -f ([Embed2.Win32]::GetParent($target.Handle)).ToInt64())  (host is 0x$('{0:X}' -f $hostForm.Handle.ToInt64()))"

  # --- is anything still drawn? the host is magenta, so magenta means "not presenting" ---
  Write-Output ''
  Write-Output "=== what is inside the host, sampled for $SampleSeconds s ==="
  $rect = New-Object Embed2.Win32+RECT
  [void][Embed2.Win32]::GetClientRect($hostForm.Handle, [ref]$rect)
  $best = $null
  $bestOther = -1
  for ($sample = 0; $sample -lt $SampleSeconds; $sample++) {
    Start-Sleep -Seconds 1
    $bmp = New-Object System.Drawing.Bitmap($rect.Right, $rect.Bottom)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(1150, 420, 0, 0, $bmp.Size)
    $g.Dispose()
    $magenta = 0; $black = 0; $other = 0; $colours = @{}
    for ($y = 0; $y -lt $rect.Bottom; $y += 7) {
      for ($x = 0; $x -lt $rect.Right; $x += 7) {
        $p = $bmp.GetPixel($x, $y)
        $key = "$($p.R),$($p.G),$($p.B)"
        $colours[$key] = 1
        if ($p.R -gt 240 -and $p.G -lt 40 -and $p.B -gt 240) { $magenta++ }
        elseif ($p.R -lt 12 -and $p.G -lt 12 -and $p.B -lt 12) { $black++ }
        else { $other++ }
      }
    }
    $bmp.Dispose()
    if ($other -gt $bestOther) { $bestOther = $other; $best = [pscustomobject]@{ Magenta = $magenta; Black = $black; Other = $other; Colours = $colours.Count } }
  }
  if ($null -ne $best) {
    $total = $best.Magenta + $best.Black + $best.Other
    Write-Output "  magenta (host showing through) = $($best.Magenta) / $total"
    Write-Output "  black                          = $($best.Black) / $total"
    Write-Output "  other (game content)           = $($best.Other) / $total"
    Write-Output "  distinct colours               = $($best.Colours)"
  }

  Write-Output ''
  Write-Output '=== verdict ==='
  $alive = [Embed2.Win32]::IsWindow($target.Handle)
  $parented = $alive -and ([Embed2.Win32]::GetParent($target.Handle) -eq $hostForm.Handle)
  if (-not $alive) {
    Write-Output 'RESULT: the game destroyed its window when reparented - true embedding is not viable'
  } elseif (-not $parented) {
    Write-Output 'RESULT: SetParent did not take even with WS_CHILD set - not viable this way'
  } elseif ($null -eq $best -or $best.Other -lt 200) {
    Write-Output 'RESULT: embedded, but nothing is drawn in it - the wrapper stopped presenting into a child window'
  } elseif ($best.Colours -lt 8) {
    Write-Output "RESULT: embedded and drawing a flat surface ($($best.Colours) colours) - the game lost its content"
  } else {
    Write-Output "RESULT: EMBEDDED AND DRAWING - $($best.Colours) distinct colours inside the host: embedding is viable"
  }
} finally {
  if ($process -and -not $process.HasExited) {
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    Write-Output "killed pid $($process.Id)"
  }
  [System.IO.File]::WriteAllText($iniPath, $iniOriginal, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output 'config.ini restored'
}
