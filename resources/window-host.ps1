# window-host.ps1 - puts the game's window where the launcher wants it, and puts it back.
#
# The launcher cannot embed the game: `tools/probe-embed3.ps1` measured that the window takes the
# reparent and then the wrapper stops presenting into it (two frames three seconds apart, identical).
# So this is the other route to "the game runs inside the launcher" - the game keeps its own top-level
# window, and this moves that window exactly onto the design's gameplay card so the launcher's chrome
# sits around it. No window is reparented, so no swapchain has to tolerate a new parent.
#
# Every action prints one JSON object on stdout and exits 0, including for "nothing was found" - the
# caller is a launcher, and a launcher that cannot ask about a window must not crash because of it.
# A non-zero exit means the script itself broke.
#
# Actions:
#   query    -ProcessId N
#       every top-level window the process owns, with class, title, client size and handle
#   position -ProcessId N -Image <name> -X -Y -Width -Height [-Taskbar]
#       moves the game's window so its *client area* covers the given screen rectangle
#   release  -ProcessId N [-Image <name>]
#       undoes what `position` did: the window goes back to a normal frame and taskbar entry
#
# `-Taskbar` is the opt-in that keeps the game in the taskbar and alt-tab. Without it the window gets
# WS_EX_TOOLWINDOW while it is positioned, so it reads as part of the launcher rather than as a
# separate application competing with it.

param(
  [Parameter(Mandatory = $true)][ValidateSet('query', 'position', 'release')][string]$Action,
  [Parameter(Mandatory = $true)][int]$ProcessId,
  [string]$Image = '',
  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  [switch]$Taskbar
)

$ErrorActionPreference = 'Stop'

if (-not ('WindowHost.Win32' -as [type])) {
  Add-Type -Namespace WindowHost -Name Win32 -MemberDefinition @'
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}

$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000
$SWP_NOZORDER = 0x0004
$SWP_NOACTIVATE = 0x0010
$SWP_FRAMECHANGED = 0x0020

function Get-Windows([int]$Owner) {
  $found = New-Object System.Collections.ArrayList
  $callback = [WindowHost.Win32+EnumWindowsProc] {
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    $pid2 = 0
    [void][WindowHost.Win32]::GetWindowThreadProcessId($hWnd, [ref]$pid2)
    if ($pid2 -eq $Owner) {
      $class = New-Object System.Text.StringBuilder 256
      [void][WindowHost.Win32]::GetClassName($hWnd, $class, 256)
      $title = New-Object System.Text.StringBuilder 512
      [void][WindowHost.Win32]::GetWindowText($hWnd, $title, 512)
      $rect = New-Object WindowHost.Win32+RECT
      [void][WindowHost.Win32]::GetWindowRect($hWnd, [ref]$rect)
      $client = New-Object WindowHost.Win32+RECT
      [void][WindowHost.Win32]::GetClientRect($hWnd, [ref]$client)
      [void]$found.Add([pscustomobject]@{
          handle = ('0x{0:X}' -f $hWnd.ToInt64())
          raw = $hWnd
          class = $class.ToString()
          title = $title.ToString()
          visible = [WindowHost.Win32]::IsWindowVisible($hWnd)
          # The border/frame delta: `position` needs it to put the *client* area on the target rect
          # rather than the outer frame, which is what a design rect describes.
          borderX = ($rect.Right - $rect.Left) - $client.Right
          borderY = ($rect.Bottom - $rect.Top) - $client.Bottom
          width = $rect.Right - $rect.Left
          height = $rect.Bottom - $rect.Top
          exStyle = ('0x{0:X8}' -f ([WindowHost.Win32]::GetWindowLong($hWnd, $GWL_EXSTYLE)))
        })
    }
    return $true
  }
  [void][WindowHost.Win32]::EnumWindows($callback, [IntPtr]::Zero)
  [GC]::KeepAlive($callback)
  return $found
}

<#
  The game's window, out of everything the process owns.

  The largest visible window that is not a dialog, which is the same rule the embedding probes arrived
  at after they watched RE-Enhance's loader open and close its own windows: the loader's dialogs are
  class #32770, and the game is whatever big thing is left. `-Image` narrows it further when the caller
  knows the executable's name and the window title happens to match, which it does for these titles.
#>
function Select-GameWindow([int]$Owner, [string]$ImageName) {
  $candidates = @(Get-Windows -Owner $Owner | Where-Object { $_.visible -and $_.class -ne '#32770' -and $_.width -gt 200 -and $_.height -gt 200 })
  if ($candidates.Count -eq 0) { return $null }
  $sorted = @($candidates | Sort-Object { $_.width * $_.height } -Descending)
  if ($ImageName -ne '') {
    $named = @($sorted | Where-Object { $_.title -like "*$ImageName*" })
    if ($named.Count -gt 0) { return $named[0] }
  }
  return $sorted[0]
}

function Write-Result($Object) {
  $Object | ConvertTo-Json -Compress -Depth 5 | Write-Output
}

switch ($Action) {
  'query' {
    $windows = @(Get-Windows -Owner $ProcessId | ForEach-Object {
        [pscustomobject]@{
          handle = $_.handle; class = $_.class; title = $_.title; visible = $_.visible
          width = $_.width; height = $_.height; exStyle = $_.exStyle
          borderX = $_.borderX; borderY = $_.borderY
        }
      })
    Write-Result ([pscustomobject]@{ ok = $true; action = 'query'; processId = $ProcessId; windows = $windows })
  }

  'position' {
    $game = Select-GameWindow -Owner $ProcessId -ImageName $Image
    if ($null -eq $game) {
      # Not an error: a launcher asks about a window that may not exist yet, and the watcher will ask
      # again in a second. `found: false` is what lets it tell that apart from a failure.
      Write-Result ([pscustomobject]@{ ok = $true; action = 'position'; found = $false; reason = 'no game-sized window for that process' })
      break
    }

    $exStyleBefore = [WindowHost.Win32]::GetWindowLong($game.raw, $GWL_EXSTYLE)
    if (-not $Taskbar) {
      # Out of the taskbar and out of alt-tab, so the game reads as part of the launcher instead of a
      # second application competing with it. Reversible in `release`.
      $tool = ($exStyleBefore -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
      [void][WindowHost.Win32]::SetWindowLong($game.raw, $GWL_EXSTYLE, $tool)
    }

    # The outer frame grows by the border so the *client* area lands on the requested rectangle.
    $outerX = $X - [int][Math]::Floor($game.borderX / 2)
    $outerY = $Y - [int][Math]::Floor($game.borderY / 2)
    $outerW = $Width + $game.borderX
    $outerH = $Height + $game.borderY
    $moved = [WindowHost.Win32]::SetWindowPos($game.raw, [IntPtr]::Zero, $outerX, $outerY, $outerW, $outerH,
      ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))

    $after = New-Object WindowHost.Win32+RECT
    [void][WindowHost.Win32]::GetWindowRect($game.raw, [ref]$after)
    $clientAfter = New-Object WindowHost.Win32+RECT
    [void][WindowHost.Win32]::GetClientRect($game.raw, [ref]$clientAfter)

    Write-Result ([pscustomobject]@{
        ok = $true
        action = 'position'
        found = $true
        handle = $game.handle
        class = $game.class
        title = $game.title
        moved = $moved
        requested = [pscustomobject]@{ x = $X; y = $Y; width = $Width; height = $Height }
        client = [pscustomobject]@{ width = $clientAfter.Right; height = $clientAfter.Bottom }
        window = [pscustomobject]@{ x = $after.Left; y = $after.Top; width = $after.Right - $after.Left; height = $after.Bottom - $after.Top }
        taskbar = [bool]$Taskbar
        exStyleBefore = ('0x{0:X8}' -f $exStyleBefore)
        exStyleAfter = ('0x{0:X8}' -f ([WindowHost.Win32]::GetWindowLong($game.raw, $GWL_EXSTYLE)))
      })
  }

  'release' {
    $game = Select-GameWindow -Owner $ProcessId -ImageName $Image
    if ($null -eq $game) {
      Write-Result ([pscustomobject]@{ ok = $true; action = 'release'; found = $false })
      break
    }
    # Put it back in the taskbar and alt-tab whether or not `position` took it out: setting the bit
    # that is already clear costs nothing, and guessing wrong leaves a window nobody can alt-tab to.
    $exStyle = [WindowHost.Win32]::GetWindowLong($game.raw, $GWL_EXSTYLE)
    $restored = ($exStyle -band (-bnot $WS_EX_TOOLWINDOW)) -bor $WS_EX_APPWINDOW
    [void][WindowHost.Win32]::SetWindowLong($game.raw, $GWL_EXSTYLE, $restored)
    [void][WindowHost.Win32]::SetWindowPos($game.raw, [IntPtr]::Zero, 0, 0, 0, 0,
      ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED))
    Write-Result ([pscustomobject]@{
        ok = $true; action = 'release'; found = $true; handle = $game.handle
        exStyle = ('0x{0:X8}' -f ([WindowHost.Win32]::GetWindowLong($game.raw, $GWL_EXSTYLE)))
      })
  }
}
