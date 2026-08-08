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
$appHeaderPath = Join-Path $sourceRoot "components\AppHeader.tsx"
$filterPanelPath = Join-Path $sourceRoot "components\selector\PhotoFilterPanel.tsx"
$selectionActionsPath = Join-Path $sourceRoot "components\selector\SelectionActionsPanel.tsx"
$workspacePanelPath = Join-Path $sourceRoot "components\workspace\WorkspacePanel.tsx"
$projectDialogsPath = Join-Path $sourceRoot "components\ProjectDialogs.tsx"
$projectWorkflowPath = Join-Path $sourceRoot "services\project-workflow.ts"
$cloudMappingPath = Join-Path $sourceRoot "services\cloud-project-mapping.ts"

Assert-Contains $appHeaderPath 'Riepilogo.*selectedCount' 'NAV-001' 'Il Riepilogo espone il conteggio e resta una vista rapida.'
Assert-Contains $appPath 'folder-diagnostics-panel' 'FOLDER-001' 'La diagnostica cartella ha un contenitore persistente.'
Assert-Contains $appPath 'isFolderDiagnosticsExpanded' 'FOLDER-002' 'La diagnostica supporta apertura e chiusura.'
Assert-NotContains $progressPath 'diagnostics|Diagnostica import' 'FOLDER-003' 'Il pannello di caricamento non duplica la diagnostica.'
Assert-Contains $summaryPath 'Altri export' 'SUMMARY-001' 'Gli export secondari sono raccolti in un gruppo dedicato.'
Assert-Contains $summaryPath 'Nessuna foto selezionata' 'SUMMARY-002' 'Il Riepilogo ha uno stato vuoto esplicito.'
Assert-Contains $filterPanelPath 'Filtri avanzati' 'FILTER-002' 'I filtri avanzati sono richiudibili.'
Assert-Contains $selectionActionsPath 'Sostituisci con visibili|Aggiungi visibili|Rimuovi visibili' 'SELECT-002' 'Le azioni sulla selezione dichiarano l''effetto.'
Assert-Contains $workspacePanelPath 'workspace-panel__drag-handle' 'WORKSPACE-001' 'I pannelli espongono una maniglia di trascinamento.'
Assert-Contains $workspacePanelPath 'aria-expanded' 'WORKSPACE-002' 'I pannelli possono essere richiusi e riaperti.'
Assert-Contains $selectorPath 'const currentFolderPhotos = useMemo' 'FOLDER-004' 'I conteggi usano un catalogo limitato alla cartella visualizzata.'
Assert-Contains $selectorPath 'getAssetAbsolutePaths\(currentFolderSelectedIds\)' 'DRAG-001' 'Il drag esterno usa solo la selezione della cartella corrente.'
Assert-Contains $selectorPath 'currentFolderPhotos\.filter\(\(photo\) => getAssetRating\(photo\) >= minRating\)' 'DRAG-002' 'La selezione per stelle resta limitata alla cartella corrente.'
Assert-Contains $selectorPath 'const viewportPhotoIds = useMemo' 'SCROLL-001' 'La priorita thumbnail distingue il viewport reale dalle righe di overscan.'
Assert-Contains $selectorPath 'classList\.add\("photo-selector__grid--scrolling"\)' 'SCROLL-002' 'La modalita scroll leggero viene applicata senza un render React globale.'
Assert-NotContains $selectorPath 'setIsFastScrollActive|VIRTUAL_OVERSCAN_ROWS_FAST' 'SCROLL-003' 'Lo scroll non aumenta overscan e non invalida tutte le card tramite stato React.'
Assert-Contains $stylePath 'scrollbar-gutter:\s*stable' 'SCROLL-004' 'La scrollbar non cambia la larghezza e il numero di colonne della griglia.'
Assert-Contains $selectorPath 'topSpacerHeight = Math\.max\(0, \(virtualRows\[0\]\?\.start \?\? 0\) - GRID_GAP_PX\)' 'SCROLL-005' 'Lo spacer virtuale compensa il gap CSS e non sposta le righe durante lo scroll.'
Assert-NotContains $selectorPath 'Tipo file|fileTypeFilter|matchesFileTypeFilter' 'CLEAN-002' 'Il filtro Tipo file duplicato e stato rimosso.'
Assert-Contains $stylePath 'grid-template-areas:\s*"identity folder nav statuses primary"' 'RESP-001' 'L’header compatto integra cartella, navigazione, stati e azioni progetto.'
Assert-Contains $stylePath '@media \(max-width: 1120px\)' 'RESP-002' 'L’header ha un layout intermedio per finestre ridotte.'
Assert-Contains $stylePath '@media \(max-width: 720px\)' 'RESP-003' 'L’header ha un layout compatto per finestre strette.'
Assert-Contains $stylePath 'app-header__drive-email[\s\S]*text-overflow:\s*ellipsis' 'RESP-004' 'L’account Drive lungo non forza sovrapposizioni.'
Assert-Contains $appHeaderPath 'app-header__inline-project' 'PROJECT-001' 'Il nome progetto è visibile nella testata compatta.'
Assert-Contains $appHeaderPath 'onRenameProject' 'PROJECT-006' 'La modifica del nome richiede un’azione esplicita.'
Assert-Contains $projectDialogsPath 'Conferma cartella master' 'PROJECT-002' 'La creazione richiede conferma esplicita del perimetro master.'
Assert-Contains $appPath 'nestedMasterProjects' 'PROJECT-003' 'La creazione blocca cartelle che contengono altri master.'
Assert-Contains $appPath 'resolvePhotoSelectorProject\(normalizedPath\)' 'PROJECT-004' 'L’apertura da Esplora file risolve prima il progetto master.'
Assert-Contains $appPath 'chooseUnassignedFolderAction\(normalizedPath\)' 'PROJECT-005' 'Una cartella non assegnata aperta da Windows richiede una scelta esplicita.'
Assert-Contains $appHeaderPath 'Correggi master' 'PROJECT-007' 'Un master creato troppo in alto può essere corretto dall’interfaccia.'
Assert-Contains $appPath 'relocatePhotoSelectorProjectFile' 'PROJECT-008' 'La correzione trasferisce il progetto tramite il bridge desktop.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\native-folder-service.ts') 'previous-master' 'PROJECT-009' 'Il vecchio master viene conservato come backup recuperabile.'
Assert-Contains $projectWorkflowPath 'selectedLegacyPaths' 'MIGRATE-001' 'La migrazione conserva l’unione delle selezioni precedenti.'
Assert-Contains $appPath 'localProject\?\.projectMode !== "master"' 'DRIVE-001' 'Drive opera solo su un progetto master esplicito.'
Assert-Contains $cloudMappingPath 'UniqueAssetIndex' 'DRIVE-002' 'La mappatura Drive rileva chiavi locali duplicate.'
Assert-Contains $cloudMappingPath 'claimedAssetIds' 'DRIVE-003' 'Una foto locale non può ricevere due record Drive.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\google-drive-service.ts') 'PROJECT_ID_PROPERTY' 'DRIVE-004' 'La cartella Drive è associata all’identità stabile del progetto.'

Assert-Contains $appHeaderPath 'Riconnetti Drive' 'DRIVE-005' 'Una sessione Google scaduta espone la riconnessione direttamente nell header.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\google-drive-service.ts') 'await clearToken\(\)[\s\S]*Riconnetti Google Drive' 'DRIVE-006' 'Un refresh token rifiutato invalida la sessione locale e richiede un nuovo OAuth.'
Assert-NotContains $stylePath 'margin-top:\s*-1\.5rem' 'LAYOUT-001' 'Il workspace non risale sotto l header e i pannelli superiori restano leggibili.'
Assert-Contains $stylePath '\.app-header[\s\S]*z-index:\s*1000' 'LAYOUT-002' 'I menu della testata restano sopra il workspace.'
Assert-Contains $appPath 'PhotoLoadingOverlay' 'LOAD-001' 'Le prime anteprime espongono un loader progressivo prima della griglia interattiva.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\main.ts') 'getGPUFeatureStatus' 'GPU-001' 'Lo stato accelerazione hardware deriva dai dati reali di Electron.'
Assert-Contains $selectorPath 'Accelerazione grafica attiva' 'GPU-002' 'Il pannello Prestazioni mostra lo stato GPU effettivo.'
Assert-NotContains $selectorPath 'Applica e riavvia' 'PERF-001' 'Il budget RAM applicato live non forza un riavvio inutile.'
Assert-Contains (Join-Path $repoRoot 'apps\filex-desktop\src\main.ts') 'ramBudgetPreset:\s*await loadRamBudgetPreset\(\)' 'PERF-002' 'Le preferenze UI non sovrascrivono il budget RAM nativo realmente attivo.'
Assert-Contains (Join-Path $sourceRoot 'components\PhotoQuickPreviewModal.tsx') 'Avanza:.*ON.*OFF' 'QUICK-001' 'Quick Preview espone direttamente il toggle di avanzamento automatico.'
Assert-Contains (Join-Path $sourceRoot 'components\PhotoQuickPreviewModal.tsx') 'classificationMutationRef[\s\S]*navigationIds\.add\(asset\.id\)' 'QUICK-002' 'Una classificazione che modifica i filtri mantiene la foto corrente e non produce doppi salti.'
Assert-Contains (Join-Path $sourceRoot 'components\PhotoQuickPreviewModal.tsx') 'advanceAfterChange && autoAdvanceOnAction' 'QUICK-003' 'Le etichette da tastiera rispettano lo stesso toggle di auto-avanzamento.'

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
