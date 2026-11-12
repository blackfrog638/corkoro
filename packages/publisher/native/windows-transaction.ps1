$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Reply($value) { [Console]::WriteLine(($value | ConvertTo-Json -Compress)); }
Add-Type -TypeDefinition @'
public static class CorkoroAtomicFile {
  public static void Replace(string source, string target) {
    System.IO.File.Replace(source, target, null);
  }
}
'@
$carrier = $null
$attempted = $false
try {
  $request = [Console]::ReadLine() | ConvertFrom-Json
  $target = [string]$request.path
  $drive = New-Object System.IO.DriveInfo([IO.Path]::GetPathRoot($target))
  if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') {
    Reply @{code='TRANSACTION_UNSUPPORTED'}; exit
  }
  Reply @{status='supported'}
  $request = [Console]::ReadLine() | ConvertFrom-Json
  if ($null -eq $request) { exit }
  try {
    $carrier = New-Object System.IO.FileStream([string]$request.lock, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    $win32 = $cause.HResult -band 65535
    if ($win32 -eq 32 -or $win32 -eq 33) { Reply @{code='CONFIG_BUSY'} } else { Reply @{code='IO_ERROR'} }
    exit
  }
  if ($carrier.Length -ne 0) { Reply @{code='UNSAFE_TRANSACTION_STATE'}; exit }
  Reply @{status='ready'}
  $line = [Console]::ReadLine()
  if (!$line) { exit }
  $request = $line | ConvertFrom-Json
  if ($request.action -ne 'commit') { exit }
  $exists = [IO.File]::Exists($target) -or [IO.Directory]::Exists($target)
  if ($null -eq $request.expected) {
    if ($exists) { Reply @{code='CONFIG_EXISTS'}; exit }
  } else {
    if (!$exists) { Reply @{code='CONFIG_CHANGED'}; exit }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $version = 'sha256:' + ([BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($target)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if ($version -ne $request.expected) { Reply @{code='CONFIG_CHANGED'}; exit }
  }
  $attempted = $true
  if ($null -eq $request.expected) { [IO.File]::Move([string]$request.temp, $target) }
  else { [CorkoroAtomicFile]::Replace([string]$request.temp, $target) }
  Reply @{status='committed'}
} catch {
  if ($attempted) { Reply @{code='COMMIT_UNKNOWN'} } else { Reply @{code='IO_ERROR'} }
} finally {
  if ($null -ne $carrier) { $carrier.Dispose() }
}
