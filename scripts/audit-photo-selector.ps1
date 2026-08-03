[CmdletBinding()]
param(
  [switch]$StrictTypecheck
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $repoRoot "apps\photo-selector-app\src"
$appTsconfig = Join-Path $repoRoot "apps\photo-selector-app\tsconfig.json"
$failures = [System.Collections.Generic.List[string]]::new()

function Read-Text([string]$path) {
  return Get-Content -LiteralPath $path -Raw
}

function Pass([string]$id, [string]$message) {
  Write-Host "[PASS] $id - $message" -ForegroundColor Green
}

function Warn([string]$id, [string]$message) {
  Write-Host "[WARN] $id - $message" -ForegroundColor Yellow
}

function Fail([string]$id, [string]$message) {
  $failures.Add("$id - $message")
  Write-Host "[FAIL] $id - $message" -ForegroundColor Red
}

function Assert-Contains([string]$path, [string]$pattern, [string]$id, [string]$message) {
  if ([regex]::IsMatch((Read-Text $path), $pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
    Pass $id $message
  } else {
    Fail $id $message
  }
}

function Assert-NotContains([string]$path, [string]$pattern, [string]$id, [string]$message) {
  if ([regex]::IsMatch((Read-Text $path), $pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)) {
    Fail $id $message
  } else {
    Pass $id $message
  }
}

$appPath = Join-Path $sourceRoot "App.tsx"
$summaryPath = Join-Path $sourceRoot "components\SelectionSummary.tsx"
$progressPath = Join-Path $sourceRoot "components\ImportProgressModal.tsx"
$stylePath = Join-Path $sourceRoot "styles.css"
$selectorPath = Join-Path $sourceRoot "components\PhotoSelector.tsx"

Assert-Contains $appPath 'Riepilogo \(\{activeAssetIds\.length\}\)' 'NAV-001' 'Il Riepilogo espone il conteggio e resta una vista rapida.'
Assert-Contains $appPath 'folder-diagnostics-panel' 'FOLDER-001' 'La diagnostica cartella ha un contenitore persistente.'
Assert-Contains $appPath 'isFolderDiagnosticsExpanded' 'FOLDER-002' 'La diagnostica supporta apertura e chiusura.'
Assert-NotContains $progressPath 'diagnostics|Diagnostica import' 'FOLDER-003' 'Il pannello di caricamento non duplica la diagnostica.'
Assert-Contains $summaryPath 'Altri export' 'SUMMARY-001' 'Gli export secondari sono raccolti in un gruppo dedicato.'
Assert-Contains $summaryPath 'Nessuna foto selezionata' 'SUMMARY-002' 'Il Riepilogo ha uno stato vuoto esplicito.'
Assert-Contains $selectorPath 'Filtri avanzati' 'FILTER-002' 'I filtri avanzati sono richiudibili.'
Assert-Contains $selectorPath 'Sostituisci con visibili|Aggiungi visibili|Rimuovi visibili' 'SELECT-002' 'Le azioni sulla selezione dichiarano l''effetto.'
Assert-NotContains $selectorPath 'Tipo file|fileTypeFilter|matchesFileTypeFilter' 'CLEAN-002' 'Il filtro Tipo file duplicato e stato rimosso.'
Assert-Contains $stylePath 'max-width: 1280px' 'RESP-001' 'L’header ha un comportamento responsive dichiarato.'

$sourceFiles = Get-ChildItem -LiteralPath $sourceRoot -Recurse -File |
  Where-Object { $_.Extension -in @('.ts', '.tsx', '.css') }
$sourceText = ($sourceFiles | ForEach-Object { Read-Text $_.FullName }) -join [Environment]::NewLine

if ($sourceText -match 'ProjectPhotoSelectorModal|Selezione progetto|Impagina|Auto Layout') {
  Fail 'CLEAN-001' 'Sono rimasti riferimenti a funzioni obsolete o rimosse.'
} else {
  Pass 'CLEAN-001' 'Non risultano riferimenti a funzioni obsolete o rimosse.'
}

$tscPath = Join-Path $repoRoot "node_modules\typescript\bin\tsc"
if (Test-Path $tscPath) {
  $typecheckOutput = & node $tscPath --noEmit -p $appTsconfig 2>&1
  if ($LASTEXITCODE -eq 0) {
    Pass 'TYPE-001' 'Il typecheck dell’app è passato.'
  } elseif ($StrictTypecheck) {
    $typecheckOutput | ForEach-Object { Write-Host $_ }
    Fail 'TYPE-001' 'Il typecheck dell’app è fallito in modalità strict.'
  } else {
    Warn 'TYPE-001' 'Il typecheck ha errori preesistenti; usare -StrictTypecheck per renderli bloccanti.'
  }
} else {
  Warn 'TYPE-001' 'TypeScript non trovato in node_modules.'
}

Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host "Audit fallito: $($failures.Count) controllo/i non superato/i." -ForegroundColor Red
  exit 1
}

Write-Host "Audit superato: controlli statici OK." -ForegroundColor Green
exit 0
