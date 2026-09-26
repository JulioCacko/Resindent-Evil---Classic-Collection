# probe-embed.ps1 — can the game's window be reparented into a host window?
#
# This answers one question before any of it is wired into the launcher: these are 1998
# DirectDraw titles running behind a DDraw wrapper (dgVoodoo here), and DirectDraw's
# exclusive fullscreen cannot be reparented at all, while a wrapper that renders through
# a swapchain may or may not tolerate being made a child window. So: launch the game,
# find its window, `SetParent` it into a host form the size of the design's gameplay
# card (1300x975), and then check whether the window survived and whether anything is
# still being drawn in it.
#
# "Still being drawn" is measured rather than eyeballed: the host form is painted
# magenta, the game is reparented over it, and the client area is captured and counted.
# Magenta pixels only means the game is not drawing; the game's own colours mean it is.
#
# Usage:
#   pwsh -File tools/probe-embed.ps1 -Dir "…\GOG Games\Resident Evil" -Exe Biohazard.exe
#
# The game is killed on the way out, including a failure partway.

param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Exe,
  [int]$WaitSeconds = 20,
  # The design's gameplay card, which is where the game would have to fit.
  [int]$HostWidth = 1300,
  [int]$HostHeight = 975,
  # RE-Enhance's loader shows its own "MOD SELECTION" dialog before the game starts.
  # With this switch the probe lists that dialog's controls and presses Enter on it, so
  # the game window behind it can be reached without a human.
  [switch]$DismissDialog,
  # Try to hold the window embedded by re-applying SetParent and the style continuously.
  # A DirectDraw game typically re-asserts its own top-level window in its WndProc, and
  # this measures how often it wins: a low reset count means a watchdog can hold the
  # embedding; a high one means the game is fighting every frame and it cannot.
  [switch]$Hold,
  [int]$HoldSeconds = 6
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('EmbedProbe.Win32' -as [type])) {
  Add-Type -Namespace EmbedProbe -Name Win32 -MemberDefinition @'
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll")]
public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
[DllImport("user32.dll", SetLastError = true)]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll", SetLastError = true)]
public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
[DllImport("user32.dll", SetLastError = true)]
public static extern IntPtr GetParent(IntPtr hWnd);
[DllImport("user32.dll", SetLastError = true)]
public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")]
public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll", SetLastError = true)]
public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
[DllImport("user32.dll", SetLastError = true)]
public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
[DllImport("user32.dll", SetLastError = true)]
public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")]
public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")]
public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[StructLayout(LayoutKind.Sequential)]
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}

# Every top-level window owned by a process.
#
# A single `MainWindowHandle` is not enough and was actively misleading: the first thing
# RE-Enhance's loader shows is a `#32770` dialog titled "MOD SELECTION", which .NET
# happily reports as the main window. The game itself is a different window that appears
# later, so the probe has to see the whole set and say which is which.
function Get-ProcessWindows([int]$ProcessId) {
  $found = New-Object System.Collections.ArrayList
  $callback = [EmbedProbe.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    $owner = 0
    [void][EmbedProbe.Win32]::GetWindowThreadProcessId($hWnd, [ref]$owner)
    if ($owner -eq $ProcessId) {
      $class = New-Object System.Text.StringBuilder 256
      [void][EmbedProbe.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][EmbedProbe.Win32]::GetWindowText($hWnd, $title, 512)
      $rect = New-Object EmbedProbe.Win32+RECT
      [void][EmbedProbe.Win32]::GetWindowRect($hWnd, [ref]$rect)
      $style = [EmbedProbe.Win32]::GetWindowLong($hWnd, $GWL_STYLE)
      [void]$found.Add([pscustomobject]@{
          Handle  = $hWnd
          Class   = $class.ToString()
          Title   = $title.ToString()
          Style   = ('0x{0:X8}' -f $style)
          Flags   = Get-StyleFlags $style
          Width   = $rect.Right - $rect.Left
          Height  = $rect.Bottom - $rect.Top
          Visible = [EmbedProbe.Win32]::IsWindowVisible($hWnd)
        })
    }
    return $true
  }
  [void][EmbedProbe.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  # Keep the delegate alive until the enumeration has finished.
  [GC]::KeepAlive($callback)
  return $found
}

# The game's own window: not a dialog, and not the loader's selection box.
function Select-GameWindow($windows) {
  $candidates = @($windows | Where-Object { $_.Visible -and $_.Class -ne '#32770' })
  if ($candidates.Count -eq 0) { return $null }
  return ($candidates | Sort-Object { $_.Width * $_.Height } -Descending)[0]
}

# The child controls of a window, which is how a dialog says what it is offering.
function Get-ChildWindows([IntPtr]$Parent) {
  $children = New-Object System.Collections.ArrayList
  $callback = [EmbedProbe.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    if ([EmbedProbe.Win32]::GetParent($hWnd) -eq $Parent) {
      $class = New-Object System.Text.StringBuilder 256
      [void][EmbedProbe.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][EmbedProbe.Win32]::GetWindowText($hWnd, $title, 512)
      [void]$children.Add([pscustomobject]@{
          Handle = $hWnd
          Class  = $class.ToString()
          Title  = $title.ToString()
          Flags  = Get-StyleFlags ([EmbedProbe.Win32]::GetWindowLong($hWnd, $GWL_STYLE))
        })
    }
    return $true
  }
  [void][EmbedProbe.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $children
}

$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WS_CHILD = 0x40000000
$WS_POPUP = 0x80000000
$GWL_STYLE = -16
$SW_SHOW = 5
$BM_CLICK = 0x00F5

function Get-StyleFlags([int]$style) {
  $flags = @()
  foreach ($pair in @(
      @($WS_CHILD, 'WS_CHILD'), @($WS_POPUP, 'WS_POPUP'), @($WS_CAPTION, 'WS_CAPTION'),
      @($WS_THICKFRAME, 'WS_THICKFRAME'), @(0x10000000, 'WS_VISIBLE'), @(0x00010000, 'WS_MAXIMIZE')
    )) {
    if ($style -band $pair[0]) { $flags += $pair[1] }
  }
  if ($flags.Count -eq 0) { return '(none)' }
  return ($flags -join '|')
}

function Get-WindowInfo([IntPtr]$handle) {
  $class = New-Object System.Text.StringBuilder 256
  [void][EmbedProbe.Win32]::GetClassName($handle, $class, 256)
  $title = New-Object System.Text.StringBuilder 512
  [void][EmbedProbe.Win32]::GetWindowText($handle, $title, 512)
  $rect = New-Object EmbedProbe.Win32+RECT
  [void][EmbedProbe.Win32]::GetClientRect($handle, [ref]$rect)
  [pscustomobject]@{
    Handle = $handle
    Class  = $class.ToString()
    Title  = $title.ToString()
    Style  = ('0x{0:X8}' -f [EmbedProbe.Win32]::GetWindowLong($handle, $GWL_STYLE))
    Flags  = Get-StyleFlags ([EmbedProbe.Win32]::GetWindowLong($handle, $GWL_STYLE))
    Size   = "$($rect.Right - $rect.Left)x$($rect.Bottom - $rect.Top)"
  }
}

# The launcher patches these two before every launch (see src/main/launch.ts), so the
# probe does too - otherwise the game opens its own video-setup dialog instead of
# starting, and there would be nothing to reparent.
$ini = Join-Path $Dir 'config.ini'
$original = if (Test-Path $ini) { Get-Content $ini -Raw } else { $null }
if ($original) {
  $patched = $original -replace '(?m)^(\s*BootConfig\s*=\s*).*$', '${1}0'
  if ($patched -notmatch 'BootConfig\s*=') {
    $patched = $original.TrimEnd() + "`r`n[DLL]`r`nBootConfig = 0`r`n"
  }
  if ($patched -ne $original) {
    [System.IO.File]::WriteAllText($ini, $patched, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "patched config.ini: BootConfig = 0"
  }
}

$process = $null
$form = $null
$report = [ordered]@{}

try {
  Write-Output "launching $Exe in $Dir"
  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "pid = $($process.Id)"

  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $game = $null
  $seen = @()
  $dismissed = $false
  while ((Get-Date) -lt $deadline -and $null -eq $game) {
    Start-Sleep -Milliseconds 400
    $process.Refresh()
    if ($process.HasExited) { break }
    $seen = @(Get-ProcessWindows -ProcessId $process.Id)
    $game = Select-GameWindow $seen

    $dialog = $seen | Where-Object { $_.Visible -and $_.Class -eq '#32770' } | Select-Object -First 1
    if ($null -ne $dialog -and -not $dismissed) {
      Write-Output ""
      Write-Output "=== the loader's dialog: '0x$('{0:X}' -f $dialog.Handle.ToInt64())' $($dialog.Title) ==="
      foreach ($child in Get-ChildWindows -Parent $dialog.Handle) {
        "  child: {0,-12} {1,-24} '{2}'" -f $child.Class, $child.Flags, $child.Title
      }
      if ($DismissDialog) {
        # The dialog is RE-Enhance's own mod selector: a `#32770` with a combobox, so a
        # bare Enter only works when its default button happens to hold focus. Click the
        # button itself instead, which is what a player does.
        $clicked = $false
        foreach ($child in Get-ChildWindows -Parent $dialog.Handle) {
          if ($child.Class -ne 'Button') { continue }
          $label = $child.Title -replace '&', ''
          if ($label -match '^(OK|Ok|Start|Play|Yes|決定|はい)$') {
            [void][EmbedProbe.Win32]::SendMessage($child.Handle, $BM_CLICK, [IntPtr]::Zero, [IntPtr]::Zero)
            Write-Output "  clicked the '$label' button"
            $clicked = $true
            break
          }
        }
        if (-not $clicked) {
          [void][EmbedProbe.Win32]::SetForegroundWindow($dialog.Handle)
          Start-Sleep -Milliseconds 300
          # VK_RETURN to the dialog itself: the button has focus even when Enter through
          # SendKeys goes nowhere, because SendKeys needs a foreground input queue.
          [void][EmbedProbe.Win32]::PostMessage($dialog.Handle, 0x0100, [IntPtr]13, [IntPtr]::Zero)
          [void][EmbedProbe.Win32]::PostMessage($dialog.Handle, 0x0101, [IntPtr]13, [IntPtr]::Zero)
          Write-Output "  no button found; posted Enter to the dialog"
        }
        $dismissed = $true
      }
    }
  }

  if ($process.HasExited) {
    Write-Output "RESULT: the game exited on its own (exit code $($process.ExitCode)) before opening a game window"
    return
  }

  Write-Output ""
  Write-Output "=== every top-level window the process owns ==="
  if ($seen.Count -eq 0) { Write-Output "  (none)" }
  foreach ($w in $seen) {
    "  0x{0,-8:X} {1,-12} {2,-22} {3,5}x{4,-5} vis={5,-5} {6}" -f `
      $w.Handle.ToInt64(), $w.Class, ($w.Title -replace '\s+', ' ').Substring(0, [Math]::Min(22, $w.Title.Length)), `
      $w.Width, $w.Height, $w.Visible, $w.Flags
  }

  if ($null -eq $game) {
    Write-Output ""
    Write-Output "RESULT: no non-dialog game window appeared in $WaitSeconds s - only the loader's own dialogs, which need a choice made before the game starts"
    return
  }

  $handle = $game.Handle
  $before = Get-WindowInfo $handle
  Write-Output ""
  Write-Output "=== target: the game's own window ==="
  $before | Format-List | Out-String | Write-Output
  $report['class'] = $before.Class
  $report['styleBefore'] = $before.Style
  $report['flagsBefore'] = $before.Flags
  $report['sizeBefore'] = $before.Size

  # The host: the size and colour of the design's gameplay card, parked away from
  # (0,0) so a window that fails to reparent cannot overlap it and be mistaken for a
  # successfully embedded game. That mistake is exactly what the first version of this
  # probe made.
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'embed probe host'
  $form.ClientSize = New-Object System.Drawing.Size($HostWidth, $HostHeight)
  $form.BackColor = [System.Drawing.Color]::Magenta
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point(1150, 420)
  $form.TopMost = $true
  [void]$form.Show()
  [void][EmbedProbe.Win32]::SetForegroundWindow($form.Handle)
  Start-Sleep -Milliseconds 500
  Write-Output "host form: 0x$('{0:X}' -f $form.Handle.ToInt64())  client $($form.ClientSize.Width)x$($form.ClientSize.Height)  at $($form.Location.X),$($form.Location.Y)"

  # Reparent, strip the frame, and fit it to the client area - the three steps the
  # launcher would perform.
  $previousParent = [EmbedProbe.Win32]::GetParent($handle)
  $setParentResult = [EmbedProbe.Win32]::SetParent($handle, $form.Handle)
  $setParentError = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  $parentImmediately = [EmbedProbe.Win32]::GetParent($handle)
  $style = [EmbedProbe.Win32]::GetWindowLong($handle, $GWL_STYLE)
  $childStyle = ($style -bor $WS_CHILD) -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)
  [void][EmbedProbe.Win32]::SetWindowLong($handle, $GWL_STYLE, $childStyle)
  [void][EmbedProbe.Win32]::MoveWindow($handle, 0, 0, $form.ClientSize.Width, $form.ClientSize.Height, $true)

  $parentResets = 0
  $styleResets = 0
  $handleChanges = 0
  $samples = 0
  if ($Hold) {
    Write-Output ""
    Write-Output "=== holding it embedded for $HoldSeconds s ==="
    $end = (Get-Date).AddSeconds($HoldSeconds)
    $lastHandle = $handle
    while ((Get-Date) -lt $end) {
      $samples++
      if (-not [EmbedProbe.Win32]::IsWindow($handle)) { break }

      if ([EmbedProbe.Win32]::GetParent($handle) -ne $form.Handle) {
        [void][EmbedProbe.Win32]::SetParent($handle, $form.Handle)
        $parentResets++
      }
      $live = [EmbedProbe.Win32]::GetWindowLong($handle, $GWL_STYLE)
      if (-not ($live -band $WS_CHILD)) {
        [void][EmbedProbe.Win32]::SetWindowLong($handle, $GWL_STYLE, (($live -bor $WS_CHILD) -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)))
        $styleResets++
      }
      [void][EmbedProbe.Win32]::MoveWindow($handle, 0, 0, $form.ClientSize.Width, $form.ClientSize.Height, $false)

      Start-Sleep -Milliseconds 50
      # Does the game throw the window away and make a new one (a mode switch, say)?
      $current = @(Get-ProcessWindows -ProcessId $process.Id | Where-Object { $_.Class -eq $after.Class })
      if ($current.Count -gt 0 -and $current[0].Handle -ne $lastHandle) {
        $handleChanges++
        $lastHandle = $current[0].Handle
      }
    }
    Write-Output "  samples            = $samples"
    Write-Output "  parent re-applied  = $parentResets times"
    Write-Output "  style re-applied   = $styleResets times"
    Write-Output "  window replaced    = $handleChanges times"
    $report['parentResets'] = $parentResets
    $report['styleResets'] = $styleResets
    $report['handleChanges'] = $handleChanges
    $report['samples'] = $samples
  }

  Start-Sleep -Seconds 3

  $stillWindow = [EmbedProbe.Win32]::IsWindow($handle)
  $parentNow = [EmbedProbe.Win32]::GetParent($handle)
  $visible = [EmbedProbe.Win32]::IsWindowVisible($handle)
  $after = Get-WindowInfo $handle

  Write-Output ""
  Write-Output "=== after SetParent ==="
  "  SetParent returned  = 0x$('{0:X}' -f $setParentResult.ToInt64())  (NULL means it failed)"
  if ($setParentError -ne 0) { "  GetLastError        = $setParentError" }
  "  parent before       = 0x$('{0:X}' -f $previousParent.ToInt64())"
  "  parent immediately  = 0x$('{0:X}' -f $parentImmediately.ToInt64())"
  "  parent after 5s     = 0x$('{0:X}' -f $parentNow.ToInt64())  (host = 0x$('{0:X}' -f $form.Handle.ToInt64()))"
  "  reparented          = $($parentNow -eq $form.Handle)"
  "  IsWindow            = $stillWindow"
  "  IsWindowVisible     = $visible"
  "  style               = $($after.Style)  [$($after.Flags)]"
  "  size                = $($after.Size)"
  $report['setParentReturned'] = ('0x{0:X}' -f $setParentResult.ToInt64())
  $report['isWindow'] = $stillWindow
  $report['reparented'] = ($parentNow -eq $form.Handle)
  $report['visible'] = $visible

  # Did it keep drawing? Capture the host's client area and count what is there.
  $screenPoint = $form.PointToScreen((New-Object System.Drawing.Point(0, 0)))
  $bmp = New-Object System.Drawing.Bitmap($form.ClientSize.Width, $form.ClientSize.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.CopyFromScreen($screenPoint, [System.Drawing.Point]::Empty, $bmp.Size)
  $magenta = 0
  $black = 0
  $other = 0
  $colours = New-Object 'System.Collections.Generic.HashSet[int]'
  for ($y = 0; $y -lt $bmp.Height; $y += 7) {
    for ($x = 0; $x -lt $bmp.Width; $x += 7) {
      $pixel = $bmp.GetPixel($x, $y)
      [void]$colours.Add($pixel.ToArgb())
      if ($pixel.R -gt 200 -and $pixel.G -lt 60 -and $pixel.B -gt 200) { $magenta++ }
      elseif ($pixel.R -lt 24 -and $pixel.G -lt 24 -and $pixel.B -lt 24) { $black++ }
      else { $other++ }
    }
  }
  $sampled = $magenta + $black + $other
  $graphics.Dispose()
  $bmp.Dispose()

  Write-Output ""
  Write-Output "=== what is inside the host, sampled every 7px ==="
  "  host colour still showing = $magenta / $sampled"
  "  black                     = $black / $sampled"
  "  other (the game)          = $other / $sampled"
  "  distinct colours          = $($colours.Count)"
  $report['hostColourPixels'] = $magenta
  $report['otherPixels'] = $other
  $report['distinctColours'] = $colours.Count

  Write-Output ""
  Write-Output "=== verdict ==="
  if (-not $stillWindow) {
    Write-Output "RESULT: the game DESTROYED its window when reparented - embedding is not viable"
  } elseif (-not $report['reparented']) {
    # The claim has to rest on the parent link, not on pixels: a top-level window left
    # at (0,0) can overlap the host and look embedded while being nothing of the sort.
    Write-Output "RESULT: SetParent did NOT take (the window is still top-level) - embedding is not viable as-is"
    if ($parentImmediately -eq $form.Handle) {
      Write-Output "        note: it took at first and the game moved itself back out, so the window re-asserts its top-level status"
    }
  } elseif ($magenta -gt ($sampled * 0.8)) {
    Write-Output "RESULT: embedded, but nothing is drawn in it - the DDraw wrapper stopped presenting"
  } elseif ($colours.Count -lt 4) {
    Write-Output "RESULT: embedded and drawing a flat surface - the game lost its content"
  } else {
    Write-Output "RESULT: embedded AND still drawing $($colours.Count) distinct colours - embedding is VIABLE"
  }
} finally {
  if ($form) { $form.Close(); $form.Dispose() }
  if ($process -and -not $process.HasExited) {
    Write-Output "killing pid $($process.Id)"
    # The wrapper can leave children behind; take the tree.
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
  }
  if ($original) {
    [System.IO.File]::WriteAllText($ini, $original, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "restored config.ini"
  }
}
