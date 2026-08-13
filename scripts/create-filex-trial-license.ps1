param(
  [string]$Name,
  [int]$Days = 0,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$adminScript = Join-Path $PSScriptRoot "filex-license-admin.mjs"

function Stop-WithMessage([string]$Message) {
  Write-Host ""
  Write-Host "ERRORE: $Message" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  CREA LICENZA PROVA FILEX" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Stop-WithMessage "Node.js non e' disponibile su questo computer."
}

if (-not (Test-Path -LiteralPath $adminScript -PathType Leaf)) {
  Stop-WithMessage "Non trovo il comando amministrativo FileX."
}

if ([string]::IsNullOrWhiteSpace($Name)) {
  $Name = Read-Host "Nome della persona (es. Mario Rossi)"
}

if ([string]::IsNullOrWhiteSpace($Name)) {
  Stop-WithMessage "Il nome e' obbligatorio."
}

if ($Days -eq 0) {
  $daysText = Read-Host "Durata in giorni [30]"
  if ([string]::IsNullOrWhiteSpace($daysText)) {
    $Days = 30
  } elseif (-not [int]::TryParse($daysText, [ref]$Days)) {
    Stop-WithMessage "La durata deve essere un numero intero."
  }
}

if ($Days -lt 1 -or $Days -gt 366) {
  Stop-WithMessage "La durata deve essere compresa tra 1 e 366 giorni."
}

$label = $Name.Trim() -replace "[^a-zA-Z0-9_-]", "-"
$label = $label.Trim("-")
if ($label.Length -gt 40) { $label = $label.Substring(0, 40) }
if ([string]::IsNullOrWhiteSpace($label)) { $label = "prova" }

Write-Host ""
Write-Host "Persona: $Name"
Write-Host "Durata:  $Days giorni"

if ($DryRun) {
  Write-Host "DRY RUN: nessuna licenza creata." -ForegroundColor Yellow
  exit 0
}

Write-Host "Creazione in corso..." -ForegroundColor Yellow
Push-Location $projectRoot
try {
  $output = & node.exe $adminScript "create-support-license" "$Days" "$label" 2>&1
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($exitCode -ne 0) {
  $details = ($output | Out-String).Trim()
  Write-Host ""
  Write-Host $details -ForegroundColor DarkRed
  Stop-WithMessage "La licenza non e' stata creata. Verifica l'accesso amministrativo Google/Firebase."
}

$result = ($output | Out-String)
$match = [regex]::Match($result, "FILEX-[A-F0-9-]+")
if (-not $match.Success) {
  Stop-WithMessage "Il server ha risposto, ma non sono riuscito a leggere la chiave."
}

$licenseKey = $match.Value
try {
  Set-Clipboard -Value $licenseKey
  $clipboardMessage = "La chiave e' stata copiata negli appunti."
} catch {
  $clipboardMessage = "Copia manualmente la chiave mostrata qui sotto."
}

Write-Host ""
Write-Host "LICENZA CREATA CON SUCCESSO" -ForegroundColor Green
Write-Host "Persona:  $Name"
Write-Host "Scadenza: tra $Days giorni"
Write-Host "Chiave:   $licenseKey" -ForegroundColor White
Write-Host ""
Write-Host $clipboardMessage -ForegroundColor Green
Write-Host "Inviala alla persona, che dovra' inserirla in FileX Suite > Attiva FileX."

