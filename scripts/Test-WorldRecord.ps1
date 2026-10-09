# Run with RaceStats watching. Fake matches can fire enabled integrations.
[CmdletBinding()]
param(
    [string]$SaveDirectory = (Join-Path $env:LOCALAPPDATA 'MarblesOnStream\Saved\SaveGames'),
    [string]$Winner = 'WR_Test_Player',
    [ValidateRange(3, 100)][int]$Players = 5,
    [ValidateRange(0, 10000)][int]$RecordDelayMilliseconds = 1000,
    [switch]$Restore
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SaveDirectory -PathType Container)) {
    throw "Save folder does not exist: $SaveDirectory"
}
if ([string]::IsNullOrWhiteSpace($Winner)) { throw 'Winner must not be empty.' }
$SaveDirectory = (Resolve-Path -LiteralPath $SaveDirectory).Path
$backupDirectory = Join-Path $SaveDirectory 'MarblesStats-WR-Test-Backup'
$files = @('LastSeasonRace.csv', 'LastSeasonRaceSummary.csv', 'LastCustomRaceMapPlayed.csv')
$manifestPath = Join-Path $backupDirectory 'original-files.json'
if ($Restore) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No test backup exists in this save folder.' }
    $originals = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $manifestPath -Raw)
    foreach ($name in $files) {
        $destination = Join-Path $SaveDirectory $name
        if ($originals -contains $name) {
            Copy-Item -LiteralPath (Join-Path $backupDirectory $name) -Destination $destination -Force
        } elseif (Test-Path -LiteralPath $destination) {
            Remove-Item -LiteralPath $destination
        }
    }
    Write-Host 'Original files restored. Stop the watcher before restoring to avoid processing them.'
    return
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    $originals = @()
    foreach ($name in $files) {
        $source = Join-Path $SaveDirectory $name
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $backupDirectory $name)
            $originals += $name
        }
    }
    ConvertTo-Json -InputObject $originals | Set-Content -LiteralPath $manifestPath -Encoding UTF8
}
function Write-TestCsv([string]$Name, [object[]]$Rows) {
    $destination = Join-Path $SaveDirectory $Name
    $temporary = "$destination.wr-test.tmp"
    $csv = ($Rows | ConvertTo-Csv -NoTypeInformation) -join "`r`n"
    [System.IO.File]::WriteAllText($temporary, "$csv`r`n", [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $destination -Force
}
$map = 'WR Test Track'
$recordPath = Join-Path $SaveDirectory 'LastCustomRaceMapPlayed.csv'
$previous = if (Test-Path -LiteralPath $recordPath) { Import-Csv -LiteralPath $recordPath | Select-Object -First 1 }
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
$recordTime = 60.0 - (Get-Random -Minimum 1 -Maximum 1000) / 1000.0
$previousTime = 0.0
if ($previous -and $previous.MapName -eq $map -and
    [double]::TryParse($previous.RecordTime, [System.Globalization.NumberStyles]::Float, $invariant, [ref]$previousTime) -and $previousTime -gt 1) {
    $recordTime = $previousTime - 0.01
}
$snapshot = [guid]::NewGuid().ToString()
$generatedAt = [DateTime]::UtcNow.ToString('o', $invariant)
$rows = @(for ($position = 1; $position -le $Players; $position++) {
    $name = if ($position -eq 1) { $Winner } else { "WR_Test_Player_$position" }
    [pscustomobject][ordered]@{
        SnapshotId = $snapshot; Position = $position; Username = $name; DisplayName = $name
        Platform = 'Twitch'; NameColorHex = 'FFFFFFFF'; SeasonPointsEarned = (11 - [Math]::Min($position, 10))
        SeasonPointsTotal = (100 + 11 - [Math]::Min($position, 10)); SeasonWinsTotal = $(if ($position -eq 1) { 1 } else { 0 })
        SeasonMatchesPlayedTotal = 1; TimeInRaceSeconds = ($recordTime + $position - 1).ToString('F6', $invariant)
        Eliminated = 'false'
    }
})
Write-TestCsv 'LastSeasonRace.csv' $rows
Write-TestCsv 'LastSeasonRaceSummary.csv' @([pscustomobject][ordered]@{
    SchemaVersion = 4; SnapshotId = $snapshot; GeneratedAtUtc = $generatedAt; Status = 'Final'
    GameMode = 'Race'; SessionType = 'Simulation'; MapName = $map; MapCreator = 'Marbles Stats Test'
    PlayerCount = $Players; FinishedCount = $Players; EliminatedCount = 0; WinnerPlatform = 'Twitch'; WinnerUsername = $Winner
})
Start-Sleep -Milliseconds $RecordDelayMilliseconds
Write-TestCsv 'LastCustomRaceMapPlayed.csv' @([pscustomobject][ordered]@{
    MapName = $map; CreatorName = 'Marbles Stats Test'; DateCreated = $generatedAt; TotalRaces = 1
    ElimRate = '0.0'; AverageFinishTime = $recordTime.ToString('F6', $invariant)
    RecordTime = $recordTime.ToString('F6', $invariant); RecordHolderName = $Winner
    DateSet = [DateTime]::Now.ToString('yyyy.MM.dd-HH.mm.ss', $invariant); StreamerRecordHolder = 'LOCAL_RECORD_ONLY'
})
Write-Host "Race + WR written: $Winner, $($recordTime.ToString('F6', $invariant))s, +10 points. Snapshot: $snapshot"
Write-Host "Backup: $backupDirectory"
