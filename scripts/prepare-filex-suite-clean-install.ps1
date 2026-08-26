[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$Elevated
)

$ErrorActionPreference = "Stop"

if (-not $Apply) {
  throw "Specifica -Apply per preparare una installazione pulita di FileX Suite."
}

$legacyDirectory = "C:\Program Files\FileX-Suite"
$legacyRegistryKey = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\5466cce0-e290-57cf-8b6b-b4b1e9392e60"
$suiteUpdaterCache = Join-Path $env:LOCALAPPDATA "filex-suite-updater"
$toolUpdateCache = Join-Path $env:APPDATA "FileX Suite\updates"

function Assert-ExactPath([string]$Actual, [string]$Expected) {
  $resolvedActual = [System.IO.Path]::GetFullPath($Actual)
  $resolvedExpected = [System.IO.Path]::GetFullPath($Expected)
  if (-not $resolvedActual.Equals($resolvedExpected, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Percorso di pulizia inatteso: $resolvedActual"
  }
}

function Remove-DirectoryTree([string]$Path) {
  if ([System.IO.Directory]::Exists($Path)) {
    [System.IO.Directory]::Delete($Path, $true)
  }
}

Assert-ExactPath $suiteUpdaterCache (Join-Path $env:LOCALAPPDATA "filex-suite-updater")
Assert-ExactPath $toolUpdateCache (Join-Path $env:APPDATA "FileX Suite\updates")
Assert-ExactPath $legacyDirectory "C:\Program Files\FileX-Suite"

# Sono cache rigenerabili. Il profilo %APPDATA%\FileX Suite, la licenza e le
# preferenze non vengono mai rimossi da questo script.
Remove-DirectoryTree $suiteUpdaterCache
Remove-DirectoryTree $toolUpdateCache

$legacyPresent = [System.IO.Directory]::Exists($legacyDirectory) -or (Test-Path -LiteralPath $legacyRegistryKey)
if ($legacyPresent) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  $isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

  if (-not $isAdministrator) {
    if ($Elevated) {
      throw "La pulizia legacy richiede privilegi amministrativi."
    }

    Write-Host "Windows richiedera conferma UAC per rimuovere i residui legacy FileX Suite 0.1.14."
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

  if ([System.IO.Directory]::Exists($legacyDirectory)) {
    $entries = @([System.IO.Directory]::EnumerateFileSystemEntries($legacyDirectory))
    if ($entries.Count -gt 0) {
      throw "La cartella legacy non e vuota; rimozione automatica bloccata: $legacyDirectory"
    }
    [System.IO.Directory]::Delete($legacyDirectory, $false)
  }

  if (Test-Path -LiteralPath $legacyRegistryKey) {
    $entry = Get-ItemProperty -LiteralPath $legacyRegistryKey
    if ($entry.DisplayName -ne "FileX Suite" -or $entry.DisplayVersion -ne "0.1.14") {
      throw "La chiave legacy non corrisponde esattamente a FileX Suite 0.1.14."
    }
    Remove-Item -LiteralPath $legacyRegistryKey -Force
  }
}

$remaining = @(
  $suiteUpdaterCache,
  $toolUpdateCache,
  $legacyDirectory
) | Where-Object { Test-Path -LiteralPath $_ }

if ($remaining.Count -gt 0 -or (Test-Path -LiteralPath $legacyRegistryKey)) {
  throw "Preparazione installazione pulita incompleta."
}

Write-Host "FileX Suite clean-install preflight: PASS"
Write-Host "Profilo utente, licenza e ambiente di sviluppo preservati."
