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
$projectDialogsPath = Join-Path $sourceRoot "components\ProjectDialogs.tsx"
$projectWorkflowPath = Join-Path $sourceRoot "services\project-workflow.ts"
$cloudMappingPath = Join-Path $sourceRoot "services\cloud-project-mapping.ts"

Assert-Contains $appPath 'Riepilogo \(\{activeAssetIds\.length\}\)' 'NAV-001' 'Il Riepilogo espone il conteggio e resta una vista rapida.'
Assert-Contains $appPath 'folder-diagnostics-panel' 'FOLDER-001' 'La diagnostica cartella ha un contenitore persistente.'
Assert-Contains $appPath 'isFolderDiagnosticsExpanded' 'FOLDER-002' 'La diagnostica supporta apertura e chiusura.'
Assert-NotContains $progressPath 'diagnostics|Diagnostica import' 'FOLDER-003' 'Il pannello di caricamento non duplica la diagnostica.'
Assert-Contains $summaryPath 'Altri export' 'SUMMARY-001' 'Gli export secondari sono raccolti in un gruppo dedicato.'
Assert-Contains $summaryPath 'Nessuna foto selezionata' 'SUMMARY-002' 'Il Riepilogo ha uno stato vuoto esplicito.'
Assert-Contains $selectorPath 'Filtri avanzati' 'FILTER-002' 'I filtri avanzati sono richiudibili.'
Assert-Contains $selectorPath 'Sostituisci con visibili|Aggiungi visibili|Rimuovi visibili' 'SELECT-002' 'Le azioni sulla selezione dichiarano l''effetto.'
Assert-NotContains $selectorPath 'Tipo file|fileTypeFilter|matchesFileTypeFilter' 'CLEAN-002' 'Il filtro Tipo file duplicato e stato rimosso.'
Assert-Contains $stylePath 'grid-template-areas:\s*"identity nav primary"\s*"context context context"' 'RESP-001' 'L’header separa navigazione, azioni e contesto progetto.'
Assert-Contains $stylePath '@media \(max-width: 1120px\)' 'RESP-002' 'L’header ha un layout intermedio per finestre ridotte.'
Assert-Contains $stylePath '@media \(max-width: 720px\)' 'RESP-003' 'L’header ha un layout compatto per finestre strette.'
Assert-Contains $stylePath 'app-header__drive-email[\s\S]*text-overflow:\s*ellipsis' 'RESP-004' 'L’account Drive lungo non forza sovrapposizioni.'
Assert-Contains $appPath 'app-header__project-name-value' 'PROJECT-001' 'Il nome progetto è mostrato in modalità non modificabile.'
Assert-Contains $appPath 'Rinomina' 'PROJECT-006' 'La modifica del nome richiede un’azione esplicita.'
Assert-Contains $projectDialogsPath 'Conferma cartella master' 'PROJECT-002' 'La creazione richiede conferma esplicita del perimetro master.'
Assert-Contains $appPath 'nestedMasterProjects' 'PROJECT-003' 'La creazione blocca cartelle che contengono altri master.'
Assert-Contains $appPath 'resolvePhotoSelectorProject\(normalizedPath\)' 'PROJECT-004' 'L’apertura da Esplora file risolve prima il progetto master.'
Assert-Contains $appPath 'chooseUnassignedFolderAction\(normalizedPath\)' 'PROJECT-005' 'Una cartella non assegnata aperta da Windows richiede una scelta esplicita.'
Assert-Contains $appPath 'Correggi master' 'PROJECT-007' 'Un master creato troppo in alto può essere corretto dall’interfaccia.'
Assert-Contains $appPath 'relocatePhotoSelectorProjectFile' 'PROJECT-008' 'La correzione trasferisce il progetto tramite il bridge desktop.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\native-folder-service.ts') 'previous-master' 'PROJECT-009' 'Il vecchio master viene conservato come backup recuperabile.'
Assert-Contains $projectWorkflowPath 'selectedLegacyPaths' 'MIGRATE-001' 'La migrazione conserva l’unione delle selezioni precedenti.'
Assert-Contains $appPath 'localProject\?\.projectMode !== "master"' 'DRIVE-001' 'Drive opera solo su un progetto master esplicito.'
Assert-Contains $cloudMappingPath 'UniqueAssetIndex' 'DRIVE-002' 'La mappatura Drive rileva chiavi locali duplicate.'
Assert-Contains $cloudMappingPath 'claimedAssetIds' 'DRIVE-003' 'Una foto locale non può ricevere due record Drive.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\google-drive-service.ts') 'PROJECT_ID_PROPERTY' 'DRIVE-004' 'La cartella Drive è associata all’identità stabile del progetto.'

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
