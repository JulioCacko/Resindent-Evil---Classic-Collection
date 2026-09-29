param([Parameter(Mandatory=$true)][int]$ProcessId, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace GameCapture -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT rect);
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@
$hostScript = Join-Path $PSScriptRoot '..\resources\window-host.ps1'
$snapshot = & pwsh -NoProfile -File $hostScript -Action query -ProcessId $ProcessId | ConvertFrom-Json
$gameWindow = $snapshot.windows | Where-Object { $_.visible -and $_.class -ne '#32770' -and $_.width -gt 300 } | Sort-Object width -Descending | Select-Object -First 1
if (-not $gameWindow) { throw 'No visible game window. No screenshot evidence was produced.' }
$handle = [IntPtr][Convert]::ToInt64($gameWindow.handle.Substring(2),16)
[void][GameCapture.Native]::SetForegroundWindow($handle)
if ([GameCapture.Native]::GetForegroundWindow() -ne $handle) {
  [void](New-Object -ComObject WScript.Shell).AppActivate($ProcessId)
  Start-Sleep -Milliseconds 300
}
if ([GameCapture.Native]::GetForegroundWindow() -ne $handle) { throw 'The game is not foreground. Refusing a misleading desktop capture.' }
$rectangle = New-Object GameCapture.Native+RECT
[void][GameCapture.Native]::GetWindowRect($handle,[ref]$rectangle)
$bitmap = New-Object System.Drawing.Bitmap(($rectangle.Right-$rectangle.Left),($rectangle.Bottom-$rectangle.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($rectangle.Left,$rectangle.Top,0,0,$bitmap.Size)
  $bitmap.Save([IO.Path]::GetFullPath($Output),[System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
