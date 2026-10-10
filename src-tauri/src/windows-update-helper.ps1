param([Parameter(Mandatory=$true)][string]$Transaction,
      [Parameter(Mandatory=$true)][int]$ParentProcessId)
$ErrorActionPreference = 'Stop'
$record = Get-Content -LiteralPath (Join-Path $Transaction 'transaction.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$target = $record.target
$token = $record.token
$version = $record.version
$lock = Join-Path (Split-Path $target) ('.' + (Split-Path $target -Leaf) + '.update-lock')
$backup = Join-Path $Transaction 'backup.exe'
$download = Join-Path $Transaction 'download.exe'
$encoding = New-Object System.Text.UTF8Encoding($false)
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
  if (Test-Path -LiteralPath $target) { Move-WithRetry $target (Join-Path $Transaction 'failed.exe') }
  Move-WithRetry $backup $target
  Write-State 'rolled_back'
  Unlock
  Open-App
}
try {
  # All moves stay in the executable's folder. Resolve and check every path first.
  $resolvedTransaction = (Resolve-Path -LiteralPath $Transaction).ProviderPath
  $resolvedTarget = (Resolve-Path -LiteralPath $target).ProviderPath
  $resolvedDownload = (Resolve-Path -LiteralPath $download).ProviderPath
  $resolvedLock = (Resolve-Path -LiteralPath $lock).ProviderPath
  $targetFolder = Split-Path $resolvedTarget
  $prefix = '.' + (Split-Path $resolvedTarget -Leaf) + '.update-'
  if ((Split-Path $resolvedTransaction) -ine $targetFolder -or
      !(Split-Path $resolvedTransaction -Leaf).StartsWith($prefix) -or
      (Split-Path $resolvedDownload) -ine $resolvedTransaction -or
      (Split-Path $backup) -ine $resolvedTransaction -or
      (Split-Path $resolvedLock) -ine $targetFolder -or
      $token -notmatch '^[a-f0-9]{32}$' -or $version -notmatch '^\d+\.\d+\.\d+$' -or
      $record.ownerPid -ne $ParentProcessId) { throw 'Invalid update transaction paths.' }
  if ((Get-Content -LiteralPath (Join-Path $lock 'token') -Encoding UTF8 -Raw) -ne $token) { throw 'Update lock ownership changed.' }
  $parent = Get-Process -Id $ParentProcessId -ErrorAction Stop
  if ((Resolve-Path -LiteralPath $parent.Path).ProviderPath -ine $resolvedTarget) { throw 'The running app could not be identified; leaving it unchanged.' }
  Write-State 'ready'
  [IO.File]::WriteAllText((Join-Path $Transaction 'ready'), '', $encoding)
  $deadline = (Get-Date).AddSeconds(90)
  while (!(Test-Path -LiteralPath (Join-Path $Transaction 'commit'))) {
    if ((Test-Path -LiteralPath (Join-Path $Transaction 'cancel')) -or !(Is-Alive $ParentProcessId)) { Write-State 'cancelled'; Unlock; exit 1 }
    if ((Get-Date) -gt $deadline) { Write-State 'commit_timeout'; Unlock; exit 1 }
    Start-Sleep -Milliseconds 200
  }
  if ((Get-Content -LiteralPath (Join-Path $Transaction 'commit') -Encoding UTF8 -Raw) -ne $token) { throw 'Invalid commit token.' }
  $deadline = (Get-Date).AddSeconds(90)
  while (Is-Alive $ParentProcessId) {
    if ((Get-Date) -gt $deadline) { Write-State 'exit_timeout'; Unlock; exit 1 }
    Start-Sleep -Milliseconds 200
  }
  Write-State 'replacing'
  try { Move-WithRetry $target $backup } catch {
    Write-State 'replace_failed'; Unlock
    Open-App
    exit 1
  }
  Write-State 'backed_up'
  try {
    Move-WithRetry $download $target
    Write-State 'opening'
    Open-App "--marbles-update-token=$token"
  } catch { Rollback; exit 1 }
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Content -LiteralPath (Join-Path $Transaction 'healthy') -Encoding UTF8 -Raw -ErrorAction SilentlyContinue) -ne "$token $version") {
    if ((Get-Date) -gt $deadline) { Write-State 'startup_timeout'; Unlock; exit 1 }
    Start-Sleep -Milliseconds 200
  }
  Write-State 'complete'
  Unlock
  Remove-Item -LiteralPath $backup -Force
} catch {
  $_ | Out-String | Write-Output
  Write-State 'recovery_required'
  Unlock
  exit 1
}
