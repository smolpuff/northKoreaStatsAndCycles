param([Parameter(Mandatory=$true)][string]$Transaction,
      [Parameter(Mandatory=$true)][int]$ParentProcessId,
      [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
      [Parameter(Mandatory=$true)][ValidateRange(1,2147483648)][long]$ExpectedSize)
$ErrorActionPreference = 'Stop'
$encoding = New-Object System.Text.UTF8Encoding($false)
$validated = $false
$logDirectoryValidated = $false
function Verify-Executable([string]$path) {
  if ((Get-Item -LiteralPath $path).Length -ne $ExpectedSize -or
      (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $ExpectedSha256) {
    throw 'Update executable changed after verification; refusing to run it.'
  }
}
function Write-Log([string]$message) {
  if ($logDirectoryValidated) {
    try { [IO.File]::AppendAllText((Join-Path $Transaction 'helper.log'), $message + [Environment]::NewLine, $encoding) } catch { }
  }
}
function Write-State([string]$value) {
  [IO.File]::WriteAllText((Join-Path $Transaction 'state.next'), $value, $encoding)
  Move-Item -LiteralPath (Join-Path $Transaction 'state.next') -Destination (Join-Path $Transaction 'state') -Force
}
function Unlock {
  if ((Get-Content -LiteralPath (Join-Path $lock 'token') -Encoding UTF8 -Raw -ErrorAction SilentlyContinue) -eq $token) {
    Remove-Item -LiteralPath (Join-Path $lock 'token') -Force
    [IO.Directory]::Delete($lock)
  }
}
function Is-Alive([int]$processNumber) { return $null -ne (Get-Process -Id $processNumber -ErrorAction SilentlyContinue) }
function Move-WithRetry([string]$source, [string]$destination) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { [IO.File]::Move($source, $destination); return } catch { if ($attempt -eq 29) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
function Open-App([string]$argument = '') {
  if ($argument) { Start-Process -FilePath $target -WorkingDirectory (Split-Path $target) -WindowStyle Hidden -ArgumentList $argument }
  else { Start-Process -FilePath $target -WorkingDirectory (Split-Path $target) -WindowStyle Hidden }
}
function Rollback {
  if (Test-Path -LiteralPath $target) { Move-WithRetry $target $failed }
  Move-WithRetry $backup $target
  Write-State 'rolled_back'
  Unlock
  Open-App
}
function Cleanup-Complete {
  # Only exact transaction files are removed. Unknown files and temporary locks
  # preserve the complete receipt for a later startup cleanup attempt.
  try {
    if ((Get-Content -LiteralPath $receipt -Encoding UTF8 -Raw) -cne $receiptText) { return }
    Remove-Item -LiteralPath $receipt -Force
    foreach ($name in @('download.exe', 'helper.ps1', 'helper.log', 'RECOVERY.txt', 'ready', 'commit',
        'healthy', 'healthy.next', 'cancel', 'state.next', 'state', 'transaction.json')) {
      $path = Join-Path $Transaction $name
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    [IO.Directory]::Delete($Transaction)
  } catch {
    if (Test-Path -LiteralPath $Transaction -PathType Container) {
      [IO.File]::WriteAllText((Join-Path $Transaction 'transaction.json'), $receiptText, $encoding)
      Write-State 'complete'
      [IO.File]::WriteAllText((Join-Path $Transaction 'healthy'), "$token $version", $encoding)
      try {
        $restoreReceipt = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $bytes = $encoding.GetBytes($receiptText); $restoreReceipt.Write($bytes, 0, $bytes.Length) } finally { $restoreReceipt.Dispose() }
      } catch { }
      Write-Log ('Update installed successfully; temporary-file cleanup will be retried. ' + $_.Exception.Message)
    }
  }
}
try {
  $resolvedTransaction = (Resolve-Path -LiteralPath $Transaction).ProviderPath
  $tempRoot = (Resolve-Path -LiteralPath (Join-Path ([IO.Path]::GetTempPath()) 'MarblesStatsUpdates')).ProviderPath
  if ($Transaction -ine $resolvedTransaction -or (Split-Path $resolvedTransaction) -ine $tempRoot -or
      (Split-Path $resolvedTransaction -Leaf) -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid temporary update folder.' }
  foreach ($path in @($tempRoot, $resolvedTransaction)) {
    if (((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'The temporary update folder must not be a symbolic link or junction.'
    }
  }
  $logDirectoryValidated = $true
  $receiptText = Get-Content -LiteralPath (Join-Path $Transaction 'transaction.json') -Encoding UTF8 -Raw
  $record = $receiptText | ConvertFrom-Json
  $target = $record.target
  $token = $record.token
  $version = $record.version
  $receipt = $record.receiptPath
  $resolvedTarget = (Resolve-Path -LiteralPath $target).ProviderPath
  $targetFolder = Split-Path $resolvedTarget
  $appData = (Resolve-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.marblesstats.app')).ProviderPath
  $expectedReceipt = Join-Path $appData 'desktop-update-transaction.json'
  $prefix = '.' + (Split-Path $resolvedTarget -Leaf) + '.update-'
  $lock = Join-Path $targetFolder ('.' + (Split-Path $resolvedTarget -Leaf) + '.update-lock')
  $backup = Join-Path $targetFolder ($prefix + $token + '.backup.exe')
  $pending = Join-Path $targetFolder ($prefix + $token + '.pending.exe')
  $failed = Join-Path $targetFolder ($prefix + $token + '.failed.exe')
  $download = Join-Path $resolvedTransaction 'download.exe'
  $resolvedDownload = (Resolve-Path -LiteralPath $download).ProviderPath
  # No executable moves or cleanup until every location and owner is checked.
  if ($record.schemaVersion -ne 2 -or
      $token -cnotmatch '^[a-f0-9]{32}$' -or $version -notmatch '^\d+\.\d+\.\d+$' -or
      $record.ownerPid -ne $ParentProcessId -or
      $Transaction -ine $resolvedTransaction -or $record.directory -ine $resolvedTransaction -or
      (Split-Path $resolvedTransaction) -ine $tempRoot -or (Split-Path $resolvedTransaction -Leaf) -cne $token -or
      $target -ine $resolvedTarget -or
      (Split-Path $resolvedDownload) -ine $resolvedTransaction -or
      $receipt -ine $expectedReceipt -or (Resolve-Path -LiteralPath $receipt).ProviderPath -ine $expectedReceipt -or
      (Get-Content -LiteralPath $receipt -Encoding UTF8 -Raw) -cne $receiptText) {
    throw 'Invalid update transaction paths.'
  }
  foreach ($path in @($tempRoot, $resolvedTransaction, $targetFolder, $resolvedTarget, $resolvedDownload, $lock, $receipt)) {
    if (((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Update transaction paths must not be symbolic links or junctions.'
    }
  }
  foreach ($path in @($backup, $pending, $failed)) {
    if (Test-Path -LiteralPath $path) { throw 'A transaction executable already exists; leaving recovery files unchanged.' }
  }
  if ((Get-Content -LiteralPath (Join-Path $lock 'token') -Encoding UTF8 -Raw) -cne $token) { throw 'Update lock ownership changed.' }
  $parent = Get-Process -Id $ParentProcessId -ErrorAction Stop
  if ((Resolve-Path -LiteralPath $parent.Path).ProviderPath -ine $resolvedTarget) { throw 'The running app could not be identified; leaving it unchanged.' }
  $validated = $true
  Verify-Executable $resolvedDownload
  # Copy while the old app is still running, then verify. All replacement and
  # rollback renames stay beside the target, even when Temp is on another drive.
  $source = [IO.File]::OpenRead($resolvedDownload)
  try {
    $destination = [IO.File]::Open($pending, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $source.CopyTo($destination); $destination.Flush($true) } finally { $destination.Dispose() }
  } finally { $source.Dispose() }
  Verify-Executable $pending
  Write-State 'ready'
  [IO.File]::WriteAllText((Join-Path $Transaction 'ready'), '', $encoding)
  $deadline = (Get-Date).AddSeconds(90)
  while (!(Test-Path -LiteralPath (Join-Path $Transaction 'commit'))) {
    if ((Test-Path -LiteralPath (Join-Path $Transaction 'cancel')) -or !(Is-Alive $ParentProcessId)) { Write-State 'cancelled'; Remove-Item -LiteralPath $pending -Force; Unlock; exit 1 }
    if ((Get-Date) -gt $deadline) { Write-State 'commit_timeout'; Remove-Item -LiteralPath $pending -Force; Unlock; exit 1 }
    Start-Sleep -Milliseconds 200
  }
  if ((Get-Content -LiteralPath (Join-Path $Transaction 'commit') -Encoding UTF8 -Raw) -cne $token) { throw 'Invalid commit token.' }
  $deadline = (Get-Date).AddSeconds(90)
  while (Is-Alive $ParentProcessId) {
    if ((Get-Date) -gt $deadline) { Write-State 'exit_timeout'; Unlock; exit 1 }
    Start-Sleep -Milliseconds 200
  }
  Verify-Executable $pending
  Write-State 'replacing'
  try { Move-WithRetry $target $backup } catch {
    Write-State 'replace_failed'; Unlock
    Open-App
    exit 1
  }
  Write-State 'backed_up'
  try {
    Move-WithRetry $pending $target
    Verify-Executable $target
    Write-State 'opening'
    Open-App "--marbles-update-token=$token"
  } catch { Rollback; exit 1 }
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Content -LiteralPath (Join-Path $Transaction 'healthy') -Encoding UTF8 -Raw -ErrorAction SilentlyContinue) -cne "$token $version") {
    if ((Get-Date) -gt $deadline) { Write-State 'startup_timeout'; Unlock; exit 1 }
    Start-Sleep -Milliseconds 200
  }
  Write-State 'complete'
  try {
    Remove-Item -LiteralPath $backup -Force
    Unlock
    Cleanup-Complete
  } catch {
    Write-Log ('Update installed successfully; backup or temporary-file cleanup will be retried. ' + $_.Exception.Message)
    try { Unlock } catch { }
  }
} catch {
  Write-Log ($_ | Out-String)
  if ($validated) {
    Write-State 'recovery_required'
    Unlock
  }
  exit 1
}
