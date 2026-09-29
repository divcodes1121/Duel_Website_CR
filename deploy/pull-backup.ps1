<#
.SYNOPSIS
  Pull the newest verified Deckkies database backup off the VPS, verify it
  here, and tell the VPS it now exists off the box.

.DESCRIPTION
  The VPS makes a verified, compressed copy of the bot's database every day
  (server/db_backup.py, royalweb-backup.timer, ~02:30 UTC). A copy on the same
  disk dies with that disk, so this script — run as a scheduled task on the
  owner's PC — fetches it and only then reports it as backed up:

    1. asks the VPS for the newest VERIFIED backup and reads its manifest;
    2. skips it if this machine already holds it verified;
    3. checks there is room here, downloads to *.part and renames after;
    4. re-hashes both files (SHA-256) against the manifest and runs `zstd -t`
       over each, end to end;
    5. only when all of that passes: writes VERIFIED.txt beside them and calls
       `db_backup.py --mark-pulled`, which the VPS accepts only if the hash is
       the one it made — the admin console shows that time;
    6. keeps the newest -Keep verified copies and removes older ones, inside
       -Dest only.

  Nothing on the VPS is deleted by this script. The host is a parameter so no
  address is written into the (public) repository.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File deploy\pull-backup.ps1 -VpsHost 203.0.113.7
#>
param(
  [Parameter(Mandatory = $true)] [string] $VpsHost,
  [string] $User = 'root',
  [string] $Key = "$env:USERPROFILE\.ssh\clashbot",
  [string] $Dest = 'C:\DeckkiesBackups',
  [int] $Keep = 2,
  [string] $RemoteServer = '/opt/royalweb/server',
  [string] $RemoteDir = '/var/backups/deckkies'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$log = Join-Path $Dest 'pull.log'
function Log([string] $m) {
  $line = '{0:u}  {1}' -f (Get-Date).ToUniversalTime(), $m
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Output $line
}

$sshArgs = @('-i', $Key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=30')
function Remote([string] $cmd) {
  $out = & ssh @sshArgs "$User@$VpsHost" $cmd
  if ($LASTEXITCODE -ne 0) { throw "remote command failed ($LASTEXITCODE): $cmd" }
  return ($out -join "`n")
}

$zstd = (Get-Command zstd -ErrorAction SilentlyContinue).Source
if (-not $zstd) {
  $zstd = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter zstd.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $zstd) { throw 'zstd not found (winget install Meta.Zstandard)' }

try {
  $status = Remote "cd $RemoteServer && python3 db_backup.py --status" | ConvertFrom-Json
  if ($null -eq $status.latest) { Log 'VPS has no verified backup yet'; exit 1 }
  $name = $status.latest.name
  $manifest = Remote "cat $RemoteDir/$name.json" | ConvertFrom-Json
  $dir = Join-Path $Dest $name

  if (Test-Path (Join-Path $dir 'VERIFIED.txt')) {
    Log "$name already held and verified here"
  } else {
    $need = [int64]$manifest.zst_bytes + [int64]$manifest.extras_bytes + 2GB
    $free = (Get-PSDrive -Name ((Resolve-Path $Dest).Drive.Name)).Free
    if ($free -lt $need) { throw "not enough space in $Dest ($free free, $need needed)" }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null

    foreach ($pair in @(@($manifest.db, $manifest.sha256), @($manifest.extras, $manifest.extras_sha256))) {
      $file, $sha = $pair
      $target = Join-Path $dir $file
      Log "downloading $file"
      & scp @sshArgs "${User}@${VpsHost}:$RemoteDir/$file" "$target.part"
      if ($LASTEXITCODE -ne 0) { throw "scp failed for $file" }
      $got = (Get-FileHash -Algorithm SHA256 "$target.part").Hash.ToLower()
      if ($got -ne $sha.ToLower()) { throw "SHA-256 mismatch for $file ($got vs $sha)" }
      & $zstd -q -t "$target.part"
      if ($LASTEXITCODE -ne 0) { throw "zstd -t failed for $file" }
      Move-Item -Force "$target.part" $target
      Log "verified $file (sha256 $got)"
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $dir "$name.json")
    Set-Content -Encoding utf8 (Join-Path $dir 'VERIFIED.txt') ("verified {0:u} on {1}" -f (Get-Date).ToUniversalTime(), $env:COMPUTERNAME)
  }

  $ack = Remote "cd $RemoteServer && python3 db_backup.py --mark-pulled $name $($manifest.sha256) --host $env:COMPUTERNAME"
  Log "VPS acknowledged: $ack"

  # Keep the newest $Keep verified copies. Only folders named battles-* under
  # $Dest are ever candidates, and never one without VERIFIED.txt being newer.
  $held = Get-ChildItem -Directory $Dest -Filter 'battles-*' |
    Where-Object { Test-Path (Join-Path $_.FullName 'VERIFIED.txt') } |
    Sort-Object Name -Descending
  foreach ($old in ($held | Select-Object -Skip $Keep)) {
    Remove-Item -Recurse -Force -LiteralPath $old.FullName
    Log "removed older local copy $($old.Name)"
  }
  exit 0
} catch {
  Log "FAILED: $($_.Exception.Message)"
  exit 2
}
