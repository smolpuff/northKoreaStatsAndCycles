# Run with RaceCycles watching. Writes twenty shuffled test snapshots, all with zero points.
[CmdletBinding()]
param(
    [string]$SaveDirectory = (Join-Path $env:LOCALAPPDATA 'MarblesOnStream\Saved\SaveGames'),
    [string]$Player = 'Cycle_Test_Player',
    [ValidateRange(0, 60000)][int]$IntervalMilliseconds = 0,
    [string]$StateFile = (Join-Path $env:APPDATA 'com.marblesstats.app\data\race-state.json'),
    [ValidateRange(1, 120)][int]$TimeoutSeconds = 15,
    [switch]$Restore
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $SaveDirectory -PathType Container)) { throw "Save folder does not exist: $SaveDirectory" }
if ([string]::IsNullOrWhiteSpace($Player)) { throw 'Player must not be empty.' }
if ($Player -like 'Cycle_Test_Filler_*') { throw 'Choose a player name outside the Cycle_Test_Filler_ prefix.' }
$SaveDirectory = (Resolve-Path -LiteralPath $SaveDirectory).Path
$backupDirectory = Join-Path $SaveDirectory 'MarblesStats-Cycle-Test-Backup'
$files = @('LastSeasonRace.csv', 'LastSeasonRaceSummary.csv')
$manifestPath = Join-Path $backupDirectory 'original-files.json'
if ($Restore) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No cycle-test backup exists.' }
    $originals = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $manifestPath -Raw)
    foreach ($name in $files) {
        $destination = Join-Path $SaveDirectory $name
        if ($originals -contains $name) { Copy-Item -LiteralPath (Join-Path $backupDirectory $name) -Destination $destination -Force }
        elseif (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination }
    }
    Write-Host 'Original race files restored.'
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
function Write-CycleCsv([string]$Name, [object[]]$Rows) {
    $destination = Join-Path $SaveDirectory $Name
    $temporary = "$destination.cycle-test.tmp"
    $csv = ($Rows | ConvertTo-Csv -NoTypeInformation) -join "`r`n"
    [System.IO.File]::WriteAllText($temporary, "$csv`r`n", [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $destination -Force
}
function Read-CycleState {
    try { return ConvertFrom-Json -InputObject (Get-Content -LiteralPath $StateFile -Raw) }
    catch { return $null }
}
function Get-PlayerCycles($SavedState) {
    $tracked = $SavedState.raceCycles | Where-Object { $_.playerKey -eq ('twitch:' + $Player.Trim().ToLowerInvariant()) } | Select-Object -First 1
    if ($tracked) { return [long]$tracked.cycles }
    return 0
}
function New-CyclePlacementSequence {
    # Hold one required position until update 13. The first twelve include three repeats,
    # so a fresh set cannot complete after only ten matches. Second place appears twice.
    $lastPlacement = Get-Random -InputObject @(1,3,4,5,6,7,8,9,10)
    $firstPositions = @(1..10 | Where-Object { $_ -ne $lastPlacement })
    $otherRepeats = @($firstPositions | Where-Object { $_ -ne 2 } | Get-Random -Count 2)
    $firstTwelve = @($firstPositions + @(2) + $otherRepeats)
    $sequence = @($firstTwelve | Get-Random -Count 12)
    $sequence += $lastPlacement
    # Seven different placements in the new set make its restart visible.
    $sequence += @(1..10 | Get-Random -Count 7)
    return $sequence
}
$initialState = Read-CycleState
if (-not $initialState) { throw "Cannot read app state: $StateFile. Open the app and start RaceCycles first." }
$initialCycles = Get-PlayerCycles $initialState
$previousCycles = $initialCycles
$invariant = [System.Globalization.CultureInfo]::InvariantCulture
Write-Host 'Start RaceCycles before running this. Cycle-only snapshots: zero points, no race-result notifications.'
$placements = @(New-CyclePlacementSequence)
Write-Host '20 updates: shuffled positions, repeated places, then a new set. From empty, the first set completes on update 13.'
for ($update = 0; $update -lt $placements.Count; $update++) {
    $placement = $placements[$update]
    $snapshot = 'cycle-test:' + [guid]::NewGuid().ToString()
    $generatedAt = [DateTime]::UtcNow.ToString('o', $invariant)
    $fillers = @(1..10 | ForEach-Object { "Cycle_Test_Filler_$_" } | Get-Random -Count 9)
    $fillerIndex = 0
    $rows = @(for ($position = 1; $position -le 10; $position++) {
        $name = $Player
        if ($position -ne $placement) {
            $name = $fillers[$fillerIndex]
            $fillerIndex++
        }
        [pscustomobject][ordered]@{
            SnapshotId = $snapshot; Position = $position; Username = $name; DisplayName = $name
            Platform = 'Twitch'; NameColorHex = 'FFFFFFFF'; SeasonPointsEarned = 0; SeasonPointsTotal = 0
            SeasonWinsTotal = ''; SeasonMatchesPlayedTotal = ''; TimeInRaceSeconds = (60.0 + $position).ToString('F6', $invariant)
            Eliminated = 'false'
        }
    })
    Write-CycleCsv 'LastSeasonRace.csv' $rows
    Write-CycleCsv 'LastSeasonRaceSummary.csv' @([pscustomobject][ordered]@{
        SchemaVersion = 4; SnapshotId = $snapshot; GeneratedAtUtc = $generatedAt; Status = 'Final'
        GameMode = 'Race'; SessionType = 'Simulation'; MapName = 'Cycle Test Track'; MapCreator = 'Marbles Stats Test'
        PlayerCount = 10; FinishedCount = 10; EliminatedCount = 0; WinnerPlatform = 'Twitch'; WinnerUsername = $rows[0].Username
    })
    # Never overwrite a placement until RaceCycles has actually committed it.
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $accepted = $false
    do {
        Start-Sleep -Milliseconds 100
        $savedState = Read-CycleState
        $accepted = $savedState -and ($savedState.cycleProcessedIds -contains "source:$snapshot")
    } while (-not $accepted -and [DateTime]::UtcNow -lt $deadline)
    if (-not $accepted) {
        throw "Update $($update + 1)/20 (place $placement) was not processed by RaceCycles within $TimeoutSeconds seconds. Start RaceCycles and check its CSV folder and Live log. Test stopped without overwriting this placement."
    }
    $trackedPlayer = $savedState.raceCycles | Where-Object { $_.playerKey -eq ('twitch:' + $Player.Trim().ToLowerInvariant()) } | Select-Object -First 1
    $cyclesNow = Get-PlayerCycles $savedState
    $progressNow = @($trackedPlayer.currentCyclePositions).Count
    Write-Host "Update $($update + 1)/20 accepted: $Player finished in place $placement; progress $progressNow/10; completed cycles $cyclesNow."
    if ($cyclesNow -gt $previousCycles) { Write-Host "CYCLE COMPLETE for ${Player}: cycle $cyclesNow." }
    $previousCycles = $cyclesNow
    if ($IntervalMilliseconds -gt 0) { Start-Sleep -Milliseconds $IntervalMilliseconds }
}
if ((Get-PlayerCycles $savedState) -le $initialCycles) { throw 'All placements were accepted but no new cycle was saved. Check Live log.' }
Write-Host "Confirmed: $Player completed a new cycle. Check the Cycle completed overlay, enabled hooks, and Live log."
Write-Host "Backup: $backupDirectory (stop the watcher before running with -Restore)."
