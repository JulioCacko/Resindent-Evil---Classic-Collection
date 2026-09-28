# probe-embed3.ps1 - does the game keep DRAWING once its window is a child of another?
#
# The two earlier probes each lost their answer to something other than the question:
#
#   - probe-embed.ps1 ran the game in exclusive fullscreen, which its own header admits cannot be
#     reparented, and reported `IsWindow = False` on a handle it never validated.
#   - probe-embed2.ps1 fixed the handle discipline and established that in windowed mode the game's
#     window is a plain top-level window (`class=BIOHAZARD 1286x989 style=0x1ECA0000`, no WS_POPUP),
#     then could not get past RE-Enhance's MOD SELECTION dialog - a custom-drawn window with no child
#     controls, where a blind Enter sometimes starts the game and sometimes exits it with code 0.
#
# So this one takes the dialog seriously: the strategy for dismissing it is a parameter, so the
# strategies can be tried in sequence and the one that works is recorded rather than guessed at. And
# it detaches the window before killing the game, so a failed attempt cannot leave a child of a dead
# parent behind.
#
# Usage:
#   pwsh -File tools/probe-embed3.ps1 -Dir "<install>" -Exe Biohazard.exe -Strategy click-center
#   pwsh -File tools/probe-embed3.ps1 -Dir "<install>" -Exe Biohazard.exe -Strategy down-enter

param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Exe,
  # How to answer the loader's MOD SELECTION dialog, whose options are drawn rather than made of
  # controls: 'enter', 'space', 'down-enter', 'click-center', 'click-upper', 'click-lower'.
  [string]$Strategy = 'click-center',
  [int]$WaitSeconds = 45,
  [int]$HostWidth = 1300,
  [int]$HostHeight = 975,
  [int]$SampleSeconds = 8
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

if (-not ('Embed3.Win32' -as [type])) {
  Add-Type -Namespace Embed3 -Name Win32 -MemberDefinition @'
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
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, System.UIntPtr dwExtraInfo);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}

$GWL_STYLE = -16
$WS_CHILD = 0x40000000
$WS_POPUP = 0x80000000
$WS_CAPTION = 0x00C00000
$WS_THICKFRAME = 0x00040000
$WM_KEYDOWN = 0x0100
$WM_KEYUP = 0x0101
$WM_CHAR = 0x0102
$VK_RETURN = 13
$VK_SPACE = 32
$VK_DOWN = 40
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function Get-ProcessWindows([int]$ProcessId) {
  $found = New-Object System.Collections.ArrayList
  $callback = [Embed3.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    $owner = 0
    [void][Embed3.Win32]::GetWindowThreadProcessId($hWnd, [ref]$owner)
    if ($owner -eq $ProcessId) {
      $class = New-Object System.Text.StringBuilder 256
      [void][Embed3.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][Embed3.Win32]::GetWindowText($hWnd, $title, 512)
      $r = New-Object Embed3.Win32+RECT
      [void][Embed3.Win32]::GetWindowRect($hWnd, [ref]$r)
      [void]$found.Add([pscustomobject]@{
          Handle = $hWnd
          Class = $class.ToString()
          Title = $title.ToString()
          Left = $r.Left; Top = $r.Top
          Width = $r.Right - $r.Left
          Height = $r.Bottom - $r.Top
          Style = [Embed3.Win32]::GetWindowLong($hWnd, $GWL_STYLE)
          Visible = [Embed3.Win32]::IsWindowVisible($hWnd)
        })
    }
    return $true
  }
  [void][Embed3.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $found
}

function Describe([IntPtr]$Handle) {
  if (-not [Embed3.Win32]::IsWindow($Handle)) { return 'handle is not a window any more' }
  $class = New-Object System.Text.StringBuilder 256
  [void][Embed3.Win32]::GetClassName($Handle, $class, 256)
  $title = New-Object System.Text.StringBuilder 512
  [void][Embed3.Win32]::GetWindowText($Handle, $title, 512)
  $r = New-Object Embed3.Win32+RECT
  [void][Embed3.Win32]::GetWindowRect($Handle, [ref]$r)
  $client = New-Object Embed3.Win32+RECT
  [void][Embed3.Win32]::GetClientRect($Handle, [ref]$client)
  $style = [Embed3.Win32]::GetWindowLong($Handle, $GWL_STYLE)
  return "class=$($class.ToString()) $($r.Right - $r.Left)x$($r.Bottom - $r.Top) client=$($client.Right)x$($client.Bottom) style=0x$('{0:X8}' -f $style) parent=0x$('{0:X}' -f ([Embed3.Win32]::GetParent($Handle)).ToInt64())"
}

function Click-At([int]$X, [int]$Y) {
  [void][Embed3.Win32]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 200
  [Embed3.Win32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [System.UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [Embed3.Win32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [System.UIntPtr]::Zero)
}

function Answer-Dialog([IntPtr]$Dialog, [string]$Name) {
  $rect = New-Object Embed3.Win32+RECT
  [void][Embed3.Win32]::GetWindowRect($Dialog, [ref]$rect)
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  Write-Output "  dialog '$Name' at $($rect.Left),$($rect.Top) ${w}x${h} - strategy '$Strategy'"
  [void][Embed3.Win32]::SetForegroundWindow($Dialog)
  Start-Sleep -Milliseconds 400

  switch ($Strategy) {
    'enter' {
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
    }
    'space' {
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYDOWN, [IntPtr]$VK_SPACE, [IntPtr]::Zero)
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYUP, [IntPtr]$VK_SPACE, [IntPtr]::Zero)
    }
    'down-enter' {
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYDOWN, [IntPtr]$VK_DOWN, [IntPtr]::Zero)
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYUP, [IntPtr]$VK_DOWN, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 250
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYDOWN, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
      [void][Embed3.Win32]::PostMessage($Dialog, $WM_KEYUP, [IntPtr]$VK_RETURN, [IntPtr]::Zero)
    }
    default {
      # A custom-drawn list needs a click. The three fractions are the plausible item rows: the
      # middle of the window and one either side of it. Which one is the *right* choice cannot be
      # known from outside, so the strategy is recorded and the result is whatever the game does.
      $fraction = switch ($Strategy) {
        'click-upper' { 0.32 }
        'click-lower' { 0.68 }
        default { 0.5 }
      }
      Click-At ([int]($rect.Left + $w * 0.3)) ([int]($rect.Top + $h * $fraction))
      Start-Sleep -Milliseconds 400
      Click-At ([int]($rect.Left + $w * 0.5)) ([int]($rect.Top + $h * 0.88))
    }
  }
}

# --- the config the launcher would write, and the file put back afterwards ----------

$iniPath = Join-Path $Dir 'config.ini'
$iniOriginal = if (Test-Path $iniPath) { [System.IO.File]::ReadAllText($iniPath) } else { $null }
if ($null -eq $iniOriginal) { throw "no config.ini in $Dir - inject RE-Enhance first" }
$patched = $iniOriginal -replace '(?m)^(FullScreen\?\s*=\s*).*$', '${1}0'
$patched = $patched -replace '(?m)^(BootConfig\s*=\s*).*$', '${1}0'
[System.IO.File]::WriteAllText($iniPath, $patched, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "config.ini: windowed, no wrapper dialog (what the launcher writes before every launch)"

$process = $null
$target = $null
$hostForm = $null
try {
  $process = Start-Process -FilePath (Join-Path $Dir $Exe) -WorkingDirectory $Dir -PassThru
  Write-Output "launched $Exe (pid $($process.Id))"

  $answered = $false
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $stableFor = 0
  $lastHandle = [IntPtr]::Zero

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { break }
    $windows = @(Get-ProcessWindows -ProcessId $process.Id)

    $dialog = $windows | Where-Object { $_.Visible -and $_.Class -eq '#32770' } | Select-Object -First 1
    if ($null -ne $dialog -and -not $answered) {
      Answer-Dialog -Dialog $dialog.Handle -Name $dialog.Title
      $answered = $true
      Start-Sleep -Seconds 2
      continue
    }

    $candidate = @($windows | Where-Object { $_.Visible -and $_.Class -ne '#32770' -and $_.Width -gt 200 -and $_.Height -gt 200 } |
      Sort-Object { $_.Width * $_.Height } -Descending) | Select-Object -First 1

    if ($null -ne $candidate) {
      if ($candidate.Handle -eq $lastHandle) { $stableFor += 500 } else { $stableFor = 0 }
      $lastHandle = $candidate.Handle
      if ($stableFor -ge 1500) { $target = $candidate; break }
    }
  }

  if ($process.HasExited) {
    Write-Output "RESULT: strategy '$Strategy' did not start the game - it exited with code $($process.ExitCode)"
    return
  }
  if ($null -eq $target) {
    Write-Output "RESULT: strategy '$Strategy' left no stable game window within $WaitSeconds s"
    return
  }

  Write-Output ''
  Write-Output '=== target: stable for 1.5s, re-checked immediately before the attempt ==='
  Write-Output "  $($target.Handle.ToInt64())  $(Describe $target.Handle)"

  [void][Embed3.Win32]::SetForegroundWindow($target.Handle)
  Start-Sleep -Milliseconds 500
  if (-not [Embed3.Win32]::IsWindow($target.Handle)) {
    Write-Output 'RESULT: the handle died between the check and the attempt - the game replaces its window'
    return
  }

  $hostForm = New-Object System.Windows.Forms.Form
  $hostForm.Text = 'embed host'
  $hostForm.FormBorderStyle = 'None'
  $hostForm.StartPosition = 'Manual'
  $hostForm.Location = New-Object System.Drawing.Point(40, 40)
  $hostForm.ClientSize = New-Object System.Drawing.Size($HostWidth, $HostHeight)
  $hostForm.BackColor = [System.Drawing.Color]::Magenta
  $hostForm.TopMost = $true
  $hostForm.Show()
  [System.Windows.Forms.Application]::DoEvents()
  Write-Output "  host 0x$('{0:X}' -f $hostForm.Handle.ToInt64())  ${HostWidth}x${HostHeight} at 40,40"

  $styleBefore = [Embed3.Win32]::GetWindowLong($target.Handle, $GWL_STYLE)
  $childStyle = ($styleBefore -bor $WS_CHILD) -band (-bnot $WS_POPUP) -band (-bnot $WS_CAPTION) -band (-bnot $WS_THICKFRAME)
  [void][Embed3.Win32]::SetWindowLong($target.Handle, $GWL_STYLE, $childStyle)
  [System.Windows.Forms.Application]::DoEvents()

  $setParentResult = [Embed3.Win32]::SetParent($target.Handle, $hostForm.Handle)
  $lastError = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Output ''
  Write-Output '=== after the style surgery and SetParent ==='
  Write-Output "  SetWindowLong 0x$('{0:X8}' -f $styleBefore) -> 0x$('{0:X8}' -f ([Embed3.Win32]::GetWindowLong($target.Handle, $GWL_STYLE)))"
  Write-Output "  SetParent returned 0x$('{0:X}' -f $setParentResult.ToInt64())  GetLastError $lastError"
  Write-Output "  immediately: $(Describe $target.Handle)"

  if ([Embed3.Win32]::IsWindow($target.Handle)) {
    [void][Embed3.Win32]::MoveWindow($target.Handle, 0, 0, $HostWidth, $HostHeight, $true)
    [System.Windows.Forms.Application]::DoEvents()
  }
  Start-Sleep -Seconds 3
  Write-Output "  after 3s:    $(Describe $target.Handle)"

  Write-Output ''
  Write-Output "=== inside the host, sampled for $SampleSeconds s (magenta = the wrapper stopped presenting) ==="
  $rect = New-Object Embed3.Win32+RECT
  [void][Embed3.Win32]::GetClientRect($hostForm.Handle, [ref]$rect)
  $best = $null
  $bestOther = -1
  for ($sample = 0; $sample -lt $SampleSeconds; $sample++) {
    Start-Sleep -Seconds 1
    $bmp = New-Object System.Drawing.Bitmap($rect.Right, $rect.Bottom)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(40, 40, 0, 0, $bmp.Size)
    $g.Dispose()
    $magenta = 0; $black = 0; $other = 0; $colours = @{}
    for ($y = 0; $y -lt $rect.Bottom; $y += 7) {
      for ($x = 0; $x -lt $rect.Right; $x += 7) {
        $p = $bmp.GetPixel($x, $y)
        $colours["$($p.R),$($p.G),$($p.B)"] = 1
        if ($p.R -gt 240 -and $p.G -lt 40 -and $p.B -gt 240) { $magenta++ }
        elseif ($p.R -lt 12 -and $p.G -lt 12 -and $p.B -lt 12) { $black++ }
        else { $other++ }
      }
    }
    $bmp.Dispose()
    if ($other -gt $bestOther) {
      $bestOther = $other
      $best = [pscustomobject]@{ Magenta = $magenta; Black = $black; Other = $other; Colours = $colours.Count }
    }
  }
  if ($null -ne $best) {
    $total = $best.Magenta + $best.Black + $best.Other
    Write-Output "  magenta (host showing through) $($best.Magenta) / $total"
    Write-Output "  black                         $($best.Black) / $total"
    Write-Output "  other (game content)          $($best.Other) / $total"
    Write-Output "  distinct colours              $($best.Colours)"
  }

  # Two more captures, 3 s apart, compared sample by sample.
  #
  # This separates "the wrapper stopped presenting" from "nothing has been drawn yet", which a single
  # capture cannot: a window that is still presenting shows a *different* frame each time (the game's
  # intro animates), while a wrapper that gave up leaves a frozen remnant - and a frozen remnant looks
  # like content in one capture. An earlier run of this probe reported "EMBEDDED AND DRAWING" on
  # exactly that mistake: its host sat partly below the screen, so the capture swept the desktop and
  # counted it as game content.
  $frames = @()
  for ($capture = 0; $capture -lt 2; $capture++) {
    Start-Sleep -Seconds 3
    $bmp = New-Object System.Drawing.Bitmap($rect.Right, $rect.Bottom)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(40, 40, 0, 0, $bmp.Size)
    $g.Dispose()
    $row = New-Object System.Collections.ArrayList
    for ($y = 0; $y -lt $rect.Bottom; $y += 7) {
      for ($x = 0; $x -lt $rect.Right; $x += 7) {
        $pixel = $bmp.GetPixel($x, $y)
        [void]$row.Add((($pixel.R -shl 16) -bor ($pixel.G -shl 8) -bor $pixel.B))
      }
    }
    $bmp.Dispose()
    $frames += , $row
  }
  $changed = 0
  if ($frames.Count -eq 2) {
    for ($index = 0; $index -lt $frames[0].Count; $index++) {
      if ($frames[0][$index] -ne $frames[1][$index]) { $changed++ }
    }
    Write-Output ''
    Write-Output '=== is it still presenting? two frames 3 s apart ==='
    Write-Output "  samples compared: $($frames[0].Count)"
    Write-Output "  changed between the two frames: $changed"
  }

  Write-Output ''
  Write-Output '=== verdict ==='
  $alive = [Embed3.Win32]::IsWindow($target.Handle)
  $parented = $alive -and ([Embed3.Win32]::GetParent($target.Handle) -eq $hostForm.Handle)
  if (-not $alive) {
    Write-Output "RESULT: A3 strategy '$Strategy' - the game destroyed its window on reparent: true embedding is out"
  } elseif (-not $parented) {
    Write-Output "RESULT: A3 strategy '$Strategy' - SetParent did not take even with WS_CHILD set"
  } elseif ($changed -le 2) {
    # The window is a child, sized right, and showing something frozen. A static remnant in a child
    # window is what "the wrapper stopped presenting" looks like: its swapchain did not follow the
    # window into its new parent, so the last frame it drew stays where it was.
    Write-Output "RESULT: A2 strategy '$Strategy' - embedded and frozen: the wrapper stopped presenting into the child window"
  } elseif ($best.Colours -lt 8) {
    Write-Output "RESULT: A2 strategy '$Strategy' - embedded and drawing a flat surface ($($best.Colours) colours)"
  } else {
    Write-Output "RESULT: A1 strategy '$Strategy' - EMBEDDED AND DRAWING, $($best.Colours) distinct colours, $changed samples changing between frames"
  }
} finally {
  # Detach before killing: a child of a destroyed parent is a window nothing owns any more.
  if ($null -ne $target -and [Embed3.Win32]::IsWindow($target.Handle)) {
    if ([Embed3.Win32]::GetParent($target.Handle) -ne [IntPtr]::Zero) {
      [void][Embed3.Win32]::SetParent($target.Handle, [IntPtr]::Zero)
      Write-Output 'detached the game window back to the desktop'
    }
  }
  if ($null -ne $hostForm) { $hostForm.Close(); $hostForm.Dispose() }
  if ($process -and -not $process.HasExited) {
    & taskkill /PID $process.Id /T /F 2>&1 | Out-Null
    Write-Output "killed pid $($process.Id)"
  }
  [System.IO.File]::WriteAllText($iniPath, $iniOriginal, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output 'config.ini restored'
}
