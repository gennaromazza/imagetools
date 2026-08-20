@echo off
setlocal EnableExtensions DisableDelayedExpansion

title FileX Suite - Release automatica

set "REPO=gennaromazza/imagetools"
set "BRANCH=main"
set "PACKAGE_FILE=apps\filex-desktop\package.json"
set "WORKFLOW=windows-release.yml"
set "CANONICAL_DOWNLOAD=https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe"
set "FEED_URL=https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/latest.yml"

set "RELEASE_DONE=0"
set "TAG_PUSHED=0"
set "RUN_ID="
set "NON_INTERACTIVE=0"
set "PREFLIGHT_ONLY=0"
set "CONFIRM_TOKEN=%~3"

if /I "%~2"=="--preflight" (
    set "NON_INTERACTIVE=1"
    set "PREFLIGHT_ONLY=1"
)
if /I "%~2"=="--publish" set "NON_INTERACTIVE=1"

echo.
echo ============================================================
echo   FILEX SUITE - RELEASE AUTOMATICA
echo ============================================================
echo.

REM ============================================================
REM 1. Verifica strumenti necessari
REM ============================================================

echo [1/16] Verifica strumenti...

where git >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Git non trovato.
    goto :fail
)

where node >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Node.js non trovato.
    goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERRORE: npm non trovato.
    goto :fail
)

where gh >nul 2>&1
if errorlevel 1 (
    echo ERRORE: GitHub CLI ^(gh^) non trovato.
    echo Installa GitHub CLI e poi esegui:
    echo     gh auth login
    goto :fail
)

where curl.exe >nul 2>&1
if errorlevel 1 (
    echo ERRORE: curl.exe non trovato.
    goto :fail
)

gh auth status >nul 2>&1
if errorlevel 1 (
    echo ERRORE: GitHub CLI non autenticato.
    echo Esegui:
    echo     gh auth login
    goto :fail
)

echo OK.
echo.

REM ============================================================
REM 2. Verifica repository e branch
REM ============================================================

echo [2/16] Verifica repository Git...

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo ERRORE: esegui questo BAT dalla root del repository imagetools.
    goto :fail
)

if not exist "%PACKAGE_FILE%" (
    echo ERRORE: non trovo %PACKAGE_FILE%
    echo Probabilmente non sei nella root corretta del progetto.
    goto :fail
)

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"

if /I not "%CURRENT_BRANCH%"=="%BRANCH%" (
    echo ERRORE: sei sul branch "%CURRENT_BRANCH%".
    echo La release deve partire da "%BRANCH%".
    goto :fail
)

echo Branch: %CURRENT_BRANCH%
echo OK.
echo.

REM ============================================================
REM 3. Fetch e sincronizzazione con origin/main
REM ============================================================

echo [3/16] Sincronizzazione con GitHub...

git fetch origin --prune
if errorlevel 1 (
    echo ERRORE durante git fetch.
    goto :fail
)

set "BEHIND=0"
set "AHEAD=0"
for /f "tokens=1,2" %%A in ('git rev-list --left-right --count origin/%BRANCH%...HEAD') do (
    set "BEHIND=%%A"
    set "AHEAD=%%B"
)

echo Commit presenti solo su GitHub : %BEHIND%
echo Commit presenti solo in locale : %AHEAD%
echo.

if %BEHIND% GTR 0 if %AHEAD% GTR 0 (
    echo ERRORE: HEAD e origin/%BRANCH% sono divergenti.
    echo Lo script non esegue merge o rebase automatici.
    goto :fail
)

set "PRE_PULL_DIRTY="
for /f "delims=" %%S in ('git status --porcelain') do set "PRE_PULL_DIRTY=1"

if %BEHIND% GTR 0 (
    if defined PRE_PULL_DIRTY (
        echo ERRORE:
        echo GitHub contiene commit non presenti in locale,
        echo ma ci sono anche modifiche locali non committate.
        echo Risolvi prima manualmente la situazione.
        goto :fail
    )

    echo Aggiornamento locale tramite fast-forward...
    git pull --ff-only origin %BRANCH%
    if errorlevel 1 (
        echo ERRORE durante git pull --ff-only.
        goto :fail
    )
)

echo Repository sincronizzato.
echo.

REM ============================================================
REM 4. Legge versione corrente e nuova versione
REM ============================================================

echo [4/16] Verifica versione e CHANGELOG...

for /f "delims=" %%V in ('node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('apps/filex-desktop/package.json','utf8'));console.log(p.version)"') do set "CURRENT_VERSION=%%V"

if not defined CURRENT_VERSION (
    echo ERRORE: impossibile leggere la versione corrente.
    goto :fail
)

echo Versione package corrente: %CURRENT_VERSION%

set "VERSION=%~1"
if not defined VERSION (
    set /p "VERSION=Inserisci nuova versione, es. 0.1.39: "
)

if not defined VERSION (
    echo ERRORE: versione non specificata.
    goto :fail
)

node -e "const v=process.argv[1];process.exit(/^\d+\.\d+\.\d+$/.test(v)?0:1)" "%VERSION%"
if errorlevel 1 (
    echo ERRORE: versione non valida "%VERSION%".
    echo Usa il formato X.Y.Z, per esempio 0.1.39
    goto :fail
)

node -e "const a=process.argv[1].split('.').map(Number),b=process.argv[2].split('.').map(Number);const c=(a[0]-b[0])||(a[1]-b[1])||(a[2]-b[2]);process.exit(c>=0?0:1)" "%VERSION%" "%CURRENT_VERSION%"
if errorlevel 1 (
    echo ERRORE: la versione %VERSION% e inferiore alla versione corrente %CURRENT_VERSION%.
    goto :fail
)

if not exist CHANGELOG.md (
    echo ERRORE: CHANGELOG.md non trovato.
    goto :fail
)

node -e "const fs=require('fs');const v=process.argv[1];const s=fs.readFileSync('CHANGELOG.md','utf8');const r=new RegExp('^## \\d{4}-\\d{2}-\\d{2} - FileX Suite '+v.replace(/\\./g,'\\\\.')+'(?:\\r?\\n|$)','m');process.exit(r.test(s)?0:1)" "%VERSION%"
if errorlevel 1 (
    echo.
    echo ERRORE: CHANGELOG.md non contiene una voce per FileX Suite %VERSION%.
    echo Aggiungi prima una sezione del tipo:
    echo     ## YYYY-MM-DD - FileX Suite %VERSION%
    echo.
    goto :fail
)

set "TAG=suite-v%VERSION%"

if "%NON_INTERACTIVE%"=="1" if "%PREFLIGHT_ONLY%"=="0" if /I not "%CONFIRM_TOKEN%"=="PUBBLICA-%TAG%" (
    echo ERRORE: conferma dashboard non valida.
    echo Token richiesto: PUBBLICA-%TAG%
    goto :fail
)

echo Nuova versione : %VERSION%
echo Tag Git         : %TAG%
echo CHANGELOG       : OK
echo.

REM ============================================================
REM 5. Verifica tag non esistente
REM ============================================================

echo [5/16] Verifica tag %TAG%...

git show-ref --verify --quiet "refs/tags/%TAG%"
if not errorlevel 1 (
    echo ERRORE: il tag locale %TAG% esiste gia.
    goto :fail
)

git ls-remote --exit-code --tags origin "refs/tags/%TAG%" >nul 2>&1
if not errorlevel 1 (
    echo ERRORE: il tag %TAG% esiste gia su GitHub.
    echo NON rilanciare una release gia pubblicata.
    goto :fail
)

echo Tag disponibile.
echo.

REM ============================================================
REM 6. Stato modifiche locali
REM ============================================================

echo [6/16] Verifica modifiche locali...

set "DIRTY="
for /f "delims=" %%S in ('git status --porcelain') do set "DIRTY=1"

if defined DIRTY (
    echo.
    echo Modifiche che entreranno nella release:
    echo ------------------------------------------------------------
    git status --short
    echo ------------------------------------------------------------
    echo.
    if "%NON_INTERACTIVE%"=="1" (
        if "%PREFLIGHT_ONLY%"=="1" (
            echo Preflight dashboard: le modifiche saranno incluse nel commit di release dopo la pubblicazione.
        ) else (
            echo Pubblicazione dashboard autorizzata: le modifiche elencate saranno incluse nel commit di release.
        )
    ) else (
        choice /C SN /N /M "Vuoi includere TUTTE queste modifiche? [S/N] "
        if errorlevel 2 goto :abort
    )
) else (
    echo Nessuna modifica locale presente.
)

echo.

REM ============================================================
REM 7. Aggiorna versione package
REM ============================================================

echo [7/16] Aggiornamento versione FileX Suite...

if "%PREFLIGHT_ONLY%"=="1" (
    echo Preflight: aggiornamento versione non eseguito.
    goto :version_step_done
)

if "%CURRENT_VERSION%"=="%VERSION%" (
    echo package.json e gia alla versione %VERSION%.
) else (
    call npm version "%VERSION%" --workspace @photo-tools/filex-desktop --no-git-tag-version
    if errorlevel 1 (
        echo ERRORE durante npm version.
        goto :fail
    )
)

for /f "delims=" %%V in ('node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('apps/filex-desktop/package.json','utf8'));console.log(p.version)"') do set "CHECK_VERSION=%%V"

if not "%CHECK_VERSION%"=="%VERSION%" (
    echo ERRORE: package.json contiene %CHECK_VERSION% invece di %VERSION%.
    goto :fail
)

echo Versione package verificata: %CHECK_VERSION%
:version_step_done
echo.

REM ============================================================
REM 8. Normalizza link download sito
REM ============================================================

echo [8/16] Controllo link download del sito...

if "%PREFLIGHT_ONLY%"=="1" (
    echo Preflight: normalizzazione link non eseguita.
    goto :dependency_step
)

if not exist website (
    echo ERRORE: cartella website non trovata.
    goto :fail
)

node -e "const fs=require('fs'),p=require('path');const root='website';const canonical='https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe';const exts=new Set(['.html','.js','.json','.md','.txt']);const pats=[/https:\/\/github\.com\/gennaromazza\/imagetools\/releases\/latest\/download\/FileX-Suite-[^\s\"']+setup\.exe/g,/https:\/\/github\.com\/gennaromazza\/imagetools\/releases\/download\/suite-v[0-9A-Za-z.-]+\/FileX-Suite-[^\s\"']+setup\.exe/g];let changed=0,hits=0;function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory()){walk(f);continue;}if(!exts.has(p.extname(e.name).toLowerCase()))continue;const s=fs.readFileSync(f,'utf8');let t=s;for(const r of pats)t=t.replace(r,canonical);hits+=t.split(canonical).length-1;if(t!==s){fs.writeFileSync(f,t);console.log('Link aggiornato: '+f);changed++;}}}walk(root);console.log('File modificati: '+changed);console.log('Link canonici trovati: '+hits);process.exit(hits>0?0:2);"

if errorlevel 1 (
    echo ERRORE durante il controllo dei link del sito.
    goto :fail
)

echo Link canonico:
echo %CANONICAL_DOWNLOAD%
echo.

REM ============================================================
REM 9. Dipendenze con fingerprint locale
REM ============================================================

:dependency_step
echo [9/16] Verifica dipendenze...

set "DEP_HASH="
for /f "delims=" %%H in ('node scripts\release-dependencies-hash.mjs 2^>nul') do set "DEP_HASH=%%H"

if not defined DEP_HASH (
    echo ERRORE: impossibile calcolare fingerprint dipendenze.
    goto :fail
)

set "DEP_STAMP=node_modules\.filex-dependencies-v2-hash"
set "CACHED_DEP_HASH="
if exist "%DEP_STAMP%" set /p "CACHED_DEP_HASH=" < "%DEP_STAMP%"

if exist "node_modules\@electron\asar\lib\asar.js" if not defined CACHED_DEP_HASH (
    > "%DEP_STAMP%" echo %DEP_HASH%
    echo Dipendenze esistenti validate per la release.
    echo npm ci saltato: la dashboard resta attiva e le versioni package non richiedono reinstallazione.
) else if exist "node_modules" if "%DEP_HASH%"=="%CACHED_DEP_HASH%" (
    echo Dipendenze gia sincronizzate.
    echo npm ci saltato.
) else (
    echo Dipendenze cambiate o mancanti.
    echo Avvio npm ci...
    call npm ci
    if errorlevel 1 goto :dependencies_failed
    if not exist "node_modules\@electron\asar\lib\asar.js" goto :dependencies_failed
    > "%DEP_STAMP%" echo %DEP_HASH%
)

echo.
goto :dependencies_done

:dependencies_failed
        echo.
        echo ============================================================
        echo ERRORE: npm ci non ha ripristinato tutte le dipendenze richieste
        echo ============================================================
        echo Controlla l'errore npm immediatamente sopra.
        goto :fail

:dependencies_done
echo.

REM ============================================================
REM 10. Test e build pre-release
REM ============================================================

echo [10/16] Test e build pre-release...

echo.
echo Test updater...
call npm run test:filex-updater-lock
if errorlevel 1 (
    echo ERRORE nel test filex-updater-lock.
    goto :fail
)

echo.
echo Test release indipendenti...
call npm run test:filex-independent-releases
if errorlevel 1 (
    echo ERRORE nel test filex-independent-releases.
    goto :fail
)

echo.
echo Build shell FileX Suite...
call npm.cmd --workspace @photo-tools/filex-desktop run build:shell
if errorlevel 1 (
    echo.
    echo ============================================================
    echo ERRORE: build FileX Suite fallita
    echo ============================================================
    echo Comando fallito:
    echo npm.cmd --workspace @photo-tools/filex-desktop run build:shell
    echo.
    echo Controlla l'errore npm immediatamente sopra.
    echo La release NON e stata pubblicata.
    goto :fail
)

echo.
echo Test e build OK.
echo.

if "%PREFLIGHT_ONLY%"=="1" goto :preflight_success

REM ============================================================
REM 11. Revisione finale
REM ============================================================

echo [11/16] Stato finale prima della pubblicazione...
echo.

git status --short
echo.
echo ------------------------------------------------------------
git diff --stat
echo ------------------------------------------------------------
echo.

if "%NON_INTERACTIVE%"=="0" (
    choice /C SN /N /M "Procedo con COMMIT + PUSH + RELEASE %TAG%? [S/N] "
    if errorlevel 2 goto :abort
)

REM ============================================================
REM 12. Commit e push main
REM ============================================================

echo.
echo [12/16] Commit e push su %BRANCH%...

set "FINAL_DIRTY="
for /f "delims=" %%S in ('git status --porcelain') do set "FINAL_DIRTY=1"

if defined FINAL_DIRTY (
    git add -A
    if errorlevel 1 (
        echo ERRORE durante git add.
        goto :fail
    )

    git commit -m "release: FileX Suite v%VERSION%"
    if errorlevel 1 (
        echo ERRORE durante git commit.
        goto :fail
    )
) else (
    echo Nessuna modifica da committare.
)

git push origin %BRANCH%
if errorlevel 1 (
    echo ERRORE durante git push origin %BRANCH%.
    goto :fail
)

echo.

REM ============================================================
REM 13. Verifica HEAD == origin/main
REM ============================================================

echo [13/16] Verifica allineamento locale / GitHub...

git fetch origin %BRANCH%
if errorlevel 1 goto :fail

for /f "delims=" %%L in ('git rev-parse HEAD') do set "LOCAL_SHA=%%L"
for /f "delims=" %%R in ('git rev-parse origin/%BRANCH%') do set "REMOTE_SHA=%%R"

echo Locale : %LOCAL_SHA%
echo GitHub : %REMOTE_SHA%

if not "%LOCAL_SHA%"=="%REMOTE_SHA%" (
    echo ERRORE: HEAD locale e origin/%BRANCH% non coincidono.
    goto :fail
)

set "POST_PUSH_DIRTY="
for /f "delims=" %%S in ('git status --porcelain') do set "POST_PUSH_DIRTY=1"

if defined POST_PUSH_DIRTY (
    echo ERRORE: working tree non pulita dopo il push.
    git status --short
    goto :fail
)

echo Repository perfettamente allineato.
echo.

REM ============================================================
REM 14. Tag + GitHub Actions
REM ============================================================

echo [14/16] Creazione tag e avvio GitHub Actions...

git tag -a "%TAG%" -m "FileX Suite %VERSION%"
if errorlevel 1 (
    echo ERRORE durante creazione tag.
    goto :fail
)

git push origin "%TAG%"
if errorlevel 1 (
    echo ERRORE durante push tag.
    goto :fail
)

set "TAG_PUSHED=1"

echo.
echo Tag pubblicato: %TAG%
echo Ricerca workflow GitHub Actions...
echo.

set "RUN_ID="
for /l %%I in (1,1,40) do (
    for /f "delims=" %%R in ('gh run list --repo "%REPO%" --workflow "%WORKFLOW%" --branch "%TAG%" --event push --limit 1 --json databaseId --jq ".[0].databaseId" 2^>nul') do set "RUN_ID=%%R"
    if defined RUN_ID goto :run_found
    timeout /t 3 /nobreak >nul
)

echo ERRORE: impossibile individuare il workflow della release.
echo Controlla:
echo https://github.com/%REPO%/actions
goto :fail

:run_found

echo Workflow trovato: %RUN_ID%
echo.
echo Attendo completamento GitHub Actions...
echo.

gh run watch "%RUN_ID%" --repo "%REPO%" --exit-status
if errorlevel 1 (
    echo.
    echo ============================================================
    echo GITHUB ACTIONS FALLITA
    echo ============================================================
    echo Workflow: %RUN_ID%
    echo.
    echo Log degli step falliti:
    echo ------------------------------------------------------------
    gh run view "%RUN_ID%" --repo "%REPO%" --log-failed
    echo ------------------------------------------------------------
    echo.
    echo Workflow:
    echo https://github.com/%REPO%/actions/runs/%RUN_ID%
    echo.
    goto :fail
)

set "RELEASE_DONE=1"

echo.
echo GitHub Actions completata con SUCCESSO.
echo.

REM ============================================================
REM 15. Verifica release e feed reale
REM ============================================================

echo [15/16] Verifica release e feed updater...

gh release view "%TAG%" --repo "%REPO%" >nul 2>&1
if errorlevel 1 (
    echo ERRORE: release %TAG% non trovata.
    goto :fail
)

echo.
echo Asset release %TAG%:
gh release view "%TAG%" --repo "%REPO%" --json assets --jq ".assets[].name"
echo.

set "FEED_FILE=%TEMP%\filex-latest-%RANDOM%-%RANDOM%.yml"
curl.exe -fsSL --retry 6 --retry-delay 3 "%FEED_URL%?t=%RANDOM%%RANDOM%" -o "%FEED_FILE%"
if errorlevel 1 (
    echo ERRORE: impossibile scaricare latest.yml dal feed stabile.
    del "%FEED_FILE%" >nul 2>&1
    goto :fail
)

findstr /L /C:"version: %VERSION%" "%FEED_FILE%" >nul
if errorlevel 1 (
    echo.
    echo ERRORE: il feed stabile non contiene FileX Suite %VERSION%.
    echo.
    echo Contenuto ricevuto:
    echo ------------------------------------------------------------
    type "%FEED_FILE%"
    echo ------------------------------------------------------------
    del "%FEED_FILE%" >nul 2>&1
    goto :fail
)

del "%FEED_FILE%" >nul 2>&1

echo Feed updater verificato: FileX Suite %VERSION%.
echo.

REM ============================================================
REM 16. Deploy sito Firebase
REM ============================================================

echo [16/16] Deploy sito FileX...

call npm run deploy:website
if errorlevel 1 (
    echo.
    echo ATTENZIONE:
    echo La release %TAG% e stata creata correttamente,
    echo ma il deploy Firebase del sito e fallito.
    echo.
    echo NON rifare la release.
    echo Ripeti soltanto:
    echo     npm run deploy:website
    echo.
    goto :fail
)

REM ============================================================
REM SUCCESSO
REM ============================================================

echo.
echo ============================================================
echo   RELEASE FILEX SUITE COMPLETATA
echo ============================================================
echo.
echo Versione : %VERSION%
echo Tag      : %TAG%
echo Commit   : %LOCAL_SHA%
echo.
echo Release:
echo https://github.com/%REPO%/releases/tag/%TAG%
echo.
echo Feed updater:
echo %FEED_URL%
echo.
echo Download stabile:
echo %CANONICAL_DOWNLOAD%
echo.
echo Sito:
echo https://filex-suite.web.app/
echo.
echo FileX Suite installato dovrebbe ora rilevare
echo automaticamente la versione %VERSION%.
echo.
pause
exit /b 0

:preflight_success
echo.
echo ============================================================
echo   PREFLIGHT FILEX SUITE COMPLETATO
echo ============================================================
echo.
echo Versione verificata: %VERSION%
echo Nessun commit, tag, push o deploy e stato eseguito.
echo.
exit /b 0

:abort

echo.
echo ============================================================
echo   OPERAZIONE ANNULLATA
echo ============================================================
echo.
echo Nessun nuovo tag di release e stato pubblicato.
echo.
if "%NON_INTERACTIVE%"=="0" pause
exit /b 2

:fail

echo.
echo ============================================================
echo   RELEASE INTERROTTA
 echo ============================================================
echo.

if "%RELEASE_DONE%"=="1" (
    echo IMPORTANTE:
    echo La GitHub Action della release e gia terminata con SUCCESSO.
    echo NON rilanciare la stessa versione.
    echo L'errore e avvenuto in una verifica successiva
    echo oppure durante il deploy del sito.
    echo.
)

if "%TAG_PUSHED%"=="1" if not "%RELEASE_DONE%"=="1" (
    echo IMPORTANTE:
    echo Il tag %TAG% e gia stato pubblicato su GitHub,
    echo ma il workflow non e terminato correttamente.
    echo.
    echo NON elimino automaticamente il tag.
    echo Prima controlla il workflow con:
    if defined RUN_ID (
        echo     gh run view %RUN_ID% --repo %REPO% --log-failed
    ) else (
        echo     gh run list --repo %REPO% --workflow %WORKFLOW%
    )
    echo.
)

echo Controlla l'errore riportato sopra.
echo.
if "%NON_INTERACTIVE%"=="0" pause
exit /b 1
