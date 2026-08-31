[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"

if (-not $Apply) {
  throw "Specifica -Apply per disinstallare Suite e tool prima del test pulito."
}

$productNames = @(
  "FileX Suite",
  "Image Party Frame",
  "Batch Print Layout",
  "FileX ID Photo",
  "Archivio Flow",
  "Image Converter",
  "Trova Foto da Lista",
  "FileX Adobe Cleaner",
  "FileX Send",
  "FileX Backup Guard",
  "Image Select Pro"
)

$executableNames = @(
  "FileX-Suite",
  "Image-Party-Frame",
  "Batch-Print-Layout",
  "FileX-ID-Photo",
  "Archivio-Flow",
  "Image-Converter",
  "Trova-Foto-da-Lista",
  "FileX-Adobe-Cleaner",
  "FileX-Send",
  "FileX-Backup-Guard",
  "Image-Select-Pro"
)

$installRoots = @(
  (Join-Path $env:LOCALAPPDATA "Programs"),
  "C:\Program Files"
)

function Get-KnownInstallDirectories {
  $directories = @()
  foreach ($root in $installRoots) {
    foreach ($executableName in $executableNames) {
      $directories += Join-Path $root $executableName
    }
  }
  return $directories
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RegisteredFileXUninstallers {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  return @(Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object {
    $productNames -contains $_.DisplayName
  })
}

function Get-UninstallerPath([object]$Entry) {
  $raw = [string]$Entry.UninstallString
  if ($raw -match '^"([^"]+)"') { return $matches[1] }
  if ($raw) { return ($raw -split " ")[0] }
  return ""
}

function Assert-KnownBinaryPath([string]$Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  foreach ($directory in Get-KnownInstallDirectories) {
    $knownDirectory = [System.IO.Path]::GetFullPath($directory)
    if ($fullPath.StartsWith($knownDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      return
    }
  }
  throw "Percorso FileX non riconosciuto; operazione bloccata: $fullPath"
}

$requiresElevation = @(Get-KnownInstallDirectories | Where-Object {
  $_.StartsWith("C:\Program Files\", [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $_)
}).Count -gt 0 -or @(Get-RegisteredFileXUninstallers | Where-Object {
  $_.PSPath -match "HKEY_LOCAL_MACHINE"
}).Count -gt 0

if ($requiresElevation -and -not (Test-IsAdministrator)) {
  if ($Elevated) { throw "La pulizia completa richiede privilegi amministrativi." }
  Write-Host "Windows richiedera conferma UAC per disinstallare le installazioni FileX legacy."
  $powershell = (Get-Process -Id $PID).Path
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"' + $PSCommandPath + '"'),
    "-Apply",
    "-Elevated"
  )
  $child = Start-Process -FilePath $powershell -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  exit $child.ExitCode
}

# Un singolo uninstaller puo' avere piu registrazioni storiche. Viene eseguito
# una sola volta per percorso fisico.
$uninstallers = Get-RegisteredFileXUninstallers |
  ForEach-Object { Get-UninstallerPath $_ } |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
  Sort-Object -Unique

foreach ($uninstaller in $uninstallers) {
  Assert-KnownBinaryPath $uninstaller
  Write-Host "Disinstallazione: $uninstaller"
  $process = Start-Process -FilePath $uninstaller -ArgumentList "/S", "/KEEP_APP_DATA" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Uninstaller terminato con codice $($process.ExitCode): $uninstaller"
  }
}

# Rimuove esclusivamente directory binarie note. Dati applicativi, progetti e
# licenza non si trovano in questi percorsi e restano preservati.
foreach ($directory in Get-KnownInstallDirectories) {
  if (-not [System.IO.Directory]::Exists($directory)) { continue }
  $deadline = (Get-Date).AddSeconds(15)
  do {
    try {
      [System.IO.Directory]::Delete($directory, $true)
    } catch {
      if ((Get-Date) -ge $deadline) { throw }
      Start-Sleep -Milliseconds 500
    }
  } while ([System.IO.Directory]::Exists($directory))
}

# Dopo la rimozione dei binari, le sole registrazioni prodotto riconosciute
# sono necessariamente orfane e possono essere eliminate.
foreach ($entry in Get-RegisteredFileXUninstallers) {
  if ($productNames -notcontains $entry.DisplayName) { continue }
  Remove-Item -LiteralPath $entry.PSPath -Force -ErrorAction SilentlyContinue
}

$shortcutRoots = @(
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
  (Join-Path $env:USERPROFILE "Desktop")
)
foreach ($root in $shortcutRoots) {
  foreach ($productName in $productNames) {
    $shortcut = Join-Path $root ($productName + ".lnk")
    if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut -Force }
  }
}

& (Join-Path $PSScriptRoot "prepare-filex-suite-clean-install.ps1") -Apply -Elevated
if (-not $?) { throw "La pulizia dello stato Suite non e riuscita." }

$remainingDirectories = @(Get-KnownInstallDirectories | Where-Object { Test-Path -LiteralPath $_ })
$remainingRegistrations = @(Get-RegisteredFileXUninstallers)
if ($remainingDirectories.Count -gt 0 -or $remainingRegistrations.Count -gt 0) {
  throw "Full clean incompleto: esistono ancora binari o registrazioni FileX."
}

Write-Host "FileX full clean test state: PASS"
Write-Host "Suite e tool rimossi; profili, progetti e stato licenza preservati."
