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
    echo Installa GitHub CLI e fai: gh auth login
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
    echo.
    echo     gh auth login
    echo.
    goto :fail
)

echo OK.
echo.

REM ============================================================
REM 2. Verifica repository
REM ============================================================

echo [2/16] Verifica repository Git...

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo ERRORE: questo script deve essere eseguito dalla root di imagetools.
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
    echo La release deve essere creata da "%BRANCH%".
    goto :fail
)

echo Branch: %CURRENT_BRANCH%
echo OK.
echo.

REM ============================================================
REM 3. Legge versione corrente
REM ============================================================

echo [3/16] Lettura versione corrente...

for /f "delims=" %%V in ('node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('apps/filex-desktop/package.json','utf8'));console.log(p.version)"') do set "CURRENT_VERSION=%%V"

if not defined CURRENT_VERSION (
    echo ERRORE: impossibile leggere la versione corrente.
    goto :fail
)

echo Versione locale FileX Suite: %CURRENT_VERSION%
echo.

REM ============================================================
REM 4. Richiesta nuova versione
REM
REM Il formato atteso dell'header nel CHANGELOG.md
REM ("## YYYY-MM-DD - FileX Suite X.Y.Z") e' documentato nel
REM commento HTML in cima a CHANGELOG.md. Se cambi la regex qui
REM sotto, aggiorna anche quella nota.
REM ============================================================

echo [4/16] Lettura versione dal CHANGELOG...

set "CHANGELOG_VERSION="

if exist CHANGELOG.md (
    for /f "delims=" %%V in ('node -e "const fs=require('fs');const s=fs.readFileSync('CHANGELOG.md','utf8');const m=s.match(/^## \d{4}-\d{2}-\d{2} - FileX Suite (\d+\.\d+\.\d+)/m);if(!m){process.exit(1)};console.log(m[1])" 2^>nul') do set "CHANGELOG_VERSION=%%V"
) else (
    echo ATTENZIONE: CHANGELOG.md non trovato.
)

if defined CHANGELOG_VERSION (
    echo Versione piu recente nel CHANGELOG ^("FileX Suite"^): %CHANGELOG_VERSION%
) else (
    echo ATTENZIONE: nessuna voce "FileX Suite X.Y.Z" trovata in CHANGELOG.md.
    echo La versione dovra essere inserita manualmente.
)
echo.

set "VERSION=%~1"

if not defined VERSION (
    if defined CHANGELOG_VERSION (
        set /p "VERSION=Nuova versione [invio per usare %CHANGELOG_VERSION%]: "
        if not defined VERSION set "VERSION=%CHANGELOG_VERSION%"
    ) else (
        set /p "VERSION=Inserisci nuova versione, es. 0.1.37: "
    )
)

if not defined VERSION (
    echo ERRORE: versione non specificata.
    goto :fail
)

node -e "const v=process.argv[1];process.exit(/^\d+\.\d+\.\d+$/.test(v)?0:1)" "%VERSION%"
if errorlevel 1 (
    echo ERRORE: versione non valida "%VERSION%".
    echo Usa il formato X.Y.Z, per esempio 0.1.37
    goto :fail
)

if defined CHANGELOG_VERSION if not "%VERSION%"=="%CHANGELOG_VERSION%" (
    echo.
    echo ATTENZIONE:
    echo Stai per rilasciare la versione %VERSION%, ma la voce piu recente
    echo "FileX Suite" nel CHANGELOG.md e %CHANGELOG_VERSION%.
    echo.
    choice /C SN /N /M "Vuoi continuare comunque con %VERSION%? [S/N] "
    if errorlevel 2 goto :abort
)

if not "%VERSION%"=="%CURRENT_VERSION%" (
    node -e "const a=process.argv[1].split('.').map(Number),b=process.argv[2].split('.').map(Number);const gt=a[0]>b[0]||(a[0]===b[0]&&(a[1]>b[1]||(a[1]===b[1]&&a[2]>b[2])));if(!gt){console.error('La nuova versione deve essere superiore a '+process.argv[2]);process.exit(1)}" "%VERSION%" "%CURRENT_VERSION%"
    if errorlevel 1 goto :fail
)

set "TAG=suite-v%VERSION%"

echo Nuova versione : %VERSION%
echo Tag Git         : %TAG%
echo.

REM ============================================================
REM 5. Fetch e confronto locale/remoto
REM ============================================================

echo [5/16] Sincronizzazione con GitHub...

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
    echo ERRORE: main locale e origin/main sono divergenti.
    echo Lo script si ferma per evitare merge o rebase automatici.
    goto :fail
)

REM ============================================================
REM 6. Stato modifiche locali
REM ============================================================

echo [6/16] Verifica modifiche locali...

set "DIRTY="

for /f "delims=" %%S in ('git status --porcelain') do set "DIRTY=1"

if defined DIRTY (
    echo.
    echo Sono presenti modifiche locali:
    echo ------------------------------------------------------------
    git status --short
    echo ------------------------------------------------------------
    echo.

    if %BEHIND% GTR 0 (
        echo ERRORE:
        echo GitHub contiene commit che non hai in locale e ci sono anche
        echo modifiche locali non committate.
        echo.
        echo Lo script non effettua stash/rebase automatici per sicurezza.
        goto :fail
    )

    choice /C SN /N /M "Vuoi includere TUTTE queste modifiche nella release? [S/N] "
    if errorlevel 2 goto :abort
)

REM ============================================================
REM 7. Se GitHub e avanti, fast-forward locale
REM ============================================================

if %BEHIND% GTR 0 (
    echo.
    echo Aggiornamento main locale...

    git pull --ff-only origin %BRANCH%
    if errorlevel 1 (
        echo ERRORE durante git pull --ff-only.
        goto :fail
    )
)

REM ============================================================
REM 8. Verifica tag non esistente
REM ============================================================

echo.
echo [7/16] Verifica tag %TAG%...

git show-ref --verify --quiet "refs/tags/%TAG%"
if not errorlevel 1 (
    echo ERRORE: il tag locale %TAG% esiste gia.
    goto :fail
)

git ls-remote --exit-code --tags origin "refs/tags/%TAG%" >nul 2>&1
if not errorlevel 1 (
    echo ERRORE: il tag %TAG% esiste gia su GitHub.
    goto :fail
)

echo OK.
echo.

REM ============================================================
REM 9. Aggiornamento package.json + package-lock
REM ============================================================

echo [8/16] Aggiornamento versione FileX Suite...

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
echo.

REM ============================================================
REM 10. Normalizza tutti i link download del sito
REM ============================================================

echo [9/16] Controllo link download del sito...

node -e "const fs=require('fs'),p=require('path');const root='website',exts=new Set(['.html','.js','.json','.md','.txt']),canonical='https://github.com/gennaromazza/imagetools/releases/download/suite-channel-stable/FileX-Suite-stable-x64-setup.exe';const pats=[/https:\/\/github\.com\/gennaromazza\/imagetools\/releases\/latest\/download\/FileX-Suite-[^\s\"']+setup\.exe/g,/https:\/\/github\.com\/gennaromazza\/imagetools\/releases\/download\/suite-v[0-9A-Za-z.-]+\/FileX-Suite-[^\s\"']+setup\.exe/g];let changed=0,hits=0;function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);if(e.isDirectory())walk(f);else if(exts.has(p.extname(e.name).toLowerCase())){let s=fs.readFileSync(f,'utf8'),t=s;for(const r of pats)t=t.replace(r,canonical);hits+=t.split(canonical).length-1;if(t!==s){fs.writeFileSync(f,t);console.log('Link aggiornato: '+f);changed++;}}}}walk(root);console.log('File modificati: '+changed);console.log('Link canonici trovati: '+hits);if(hits===0)process.exit(2);"

if errorlevel 1 (
    echo ERRORE durante il controllo dei link del sito.
    goto :fail
)

echo.
echo Link canonico:
echo %CANONICAL_DOWNLOAD%
echo.

REM ============================================================
REM 11. Controllo CHANGELOG
REM ============================================================

echo [10/16] Controllo CHANGELOG...

if defined CHANGELOG_VERSION (
    echo CHANGELOG verificato allo step precedente ^(versione %CHANGELOG_VERSION%^).
) else (
    findstr /L /C:"%VERSION%" CHANGELOG.md >nul 2>&1

    if errorlevel 1 (
        echo.
        echo ATTENZIONE:
        echo CHANGELOG.md non contiene ancora la versione %VERSION%.
        echo Il contratto ufficiale FileX richiede il changelog aggiornato.
        echo.
        choice /C SN /N /M "Vuoi continuare comunque? [S/N] "
        if errorlevel 2 goto :abort
    ) else (
        echo CHANGELOG contiene %VERSION%.
    )
)

echo.

REM ============================================================
REM 12. Installazione dipendenze e test release
REM ============================================================

echo [11/16] npm ci...

REM Salta npm ci se package-lock.json e' identico all'ultima
REM installazione riuscita (hash salvato in node_modules, che
REM viene comunque azzerato ogni volta che npm ci gira davvero).

set "LOCK_HASH="
for /f "delims=" %%H in ('node -e "const {createHash}=require('crypto');const fs=require('fs');console.log(createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex'))" 2^>nul') do set "LOCK_HASH=%%H"

set "CACHED_HASH="
if exist "node_modules\.npm-ci-lock-hash" (
    set /p "CACHED_HASH=" < "node_modules\.npm-ci-lock-hash"
)

if defined LOCK_HASH if exist "node_modules" if "%LOCK_HASH%"=="%CACHED_HASH%" (
    echo Dipendenze gia sincronizzate con package-lock.json.
    echo npm ci saltato ^(cancella la cartella node_modules per forzare una reinstallazione completa^).
) else (
    call npm ci
    if errorlevel 1 (
        echo ERRORE durante npm ci.
        goto :fail
    )
    if defined LOCK_HASH (
        > "node_modules\.npm-ci-lock-hash" echo %LOCK_HASH%
    )
)

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
echo Test OK.
echo.

REM ============================================================
REM 13. Ultima verifica prima del commit
REM ============================================================

echo [12/16] Stato finale prima della pubblicazione...
echo.

git status --short

echo.
echo ------------------------------------------------------------
git diff --stat
echo ------------------------------------------------------------
echo.

choice /C SN /N /M "Procedo con COMMIT + PUSH + RELEASE %TAG%? [S/N] "
if errorlevel 2 goto :abort

REM ============================================================
REM 14. Commit
REM ============================================================

echo.
echo [13/16] Commit e push su main...

set "FINAL_DIRTY="
for /f "delims=" %%S in ('git status --porcelain') do set "FINAL_DIRTY=1"

if defined FINAL_DIRTY (
    git add -A

    git commit -m "release: FileX Suite v%VERSION%"
    if errorlevel 1 (
        echo ERRORE durante git commit.
        goto :fail
    )
) else (
    echo Nessuna modifica non committata.
)

git push origin main
if errorlevel 1 (
    echo ERRORE durante git push origin main.
    goto :fail
)

REM ============================================================
REM 15. Verifica HEAD == origin/main
REM ============================================================

echo.
echo Verifica allineamento locale / GitHub...

git fetch origin main
if errorlevel 1 goto :fail

for /f "delims=" %%L in ('git rev-parse HEAD') do set "LOCAL_SHA=%%L"
for /f "delims=" %%R in ('git rev-parse origin/main') do set "REMOTE_SHA=%%R"

echo Locale : %LOCAL_SHA%
echo GitHub : %REMOTE_SHA%

if not "%LOCAL_SHA%"=="%REMOTE_SHA%" (
    echo ERRORE: HEAD locale e origin/main non coincidono.
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
REM 16. Creazione tag e avvio GitHub Actions
REM ============================================================

echo [14/16] Creazione tag %TAG%...

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
echo Tag pubblicato.
echo GitHub Actions dovrebbe partire automaticamente.
echo.

REM ============================================================
REM 17. Cerca workflow run
REM ============================================================

echo Ricerca workflow GitHub Actions...

set "RUN_ID="

for /l %%I in (1,1,40) do (
    for /f "delims=" %%R in ('gh run list --repo "%REPO%" --workflow "%WORKFLOW%" --branch "%TAG%" --event push --limit 1 --json databaseId --jq ".[0].databaseId" 2^>nul') do set "RUN_ID=%%R"

    if defined RUN_ID goto :run_found

    timeout /t 3 /nobreak >nul
)

echo ERRORE: impossibile trovare il workflow della release.
echo Controlla manualmente:
echo https://github.com/%REPO%/actions
goto :fail

:run_found

echo Workflow trovato: %RUN_ID%
echo.
echo Attendo il risultato della GitHub Action...
echo.

gh run watch "%RUN_ID%" --repo "%REPO%" --exit-status

if errorlevel 1 (
    echo.
    echo ERRORE: GitHub Actions ha fallito.
    echo.
    echo Per vedere i log:
    echo     gh run view %RUN_ID% --repo %REPO% --log-failed
    echo.
    goto :fail
)

set "RELEASE_DONE=1"

echo.
echo GitHub Actions completata con SUCCESSO.
echo.

REM ============================================================
REM 18. Verifica release
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

set "ASSET_FILE=%TEMP%\filex-assets-%RANDOM%.txt"

gh release view "suite-channel-stable" --repo "%REPO%" --json assets --jq ".assets[].name" > "%ASSET_FILE%"

if errorlevel 1 (
    echo ERRORE: impossibile leggere suite-channel-stable.
    goto :fail
)

findstr /X /C:"latest.yml" "%ASSET_FILE%" >nul
if errorlevel 1 (
    echo ERRORE: latest.yml non trovato nel feed stabile.
    del "%ASSET_FILE%" >nul 2>&1
    goto :fail
)

findstr /X /C:"FileX-Suite-stable-x64-setup.exe" "%ASSET_FILE%" >nul
if errorlevel 1 (
    echo ERRORE: alias stabile EXE non trovato.
    del "%ASSET_FILE%" >nul 2>&1
    goto :fail
)

del "%ASSET_FILE%" >nul 2>&1

set "FEED_FILE=%TEMP%\filex-latest-%RANDOM%.yml"

curl.exe -fsSL --retry 5 --retry-delay 3 "%FEED_URL%?t=%RANDOM%" -o "%FEED_FILE%"

if errorlevel 1 (
    echo ERRORE: impossibile scaricare latest.yml remoto.
    del "%FEED_FILE%" >nul 2>&1
    goto :fail
)

findstr /L /C:"version: %VERSION%" "%FEED_FILE%" >nul

if errorlevel 1 (
    echo.
    echo ERRORE:
    echo latest.yml remoto non contiene la versione %VERSION%.
    echo.
    type "%FEED_FILE%"
    del "%FEED_FILE%" >nul 2>&1
    goto :fail
)

del "%FEED_FILE%" >nul 2>&1

echo Feed updater verificato: versione %VERSION%.
echo.

REM ============================================================
REM 19. Deploy sito Firebase
REM ============================================================

echo [16/16] Deploy sito FileX...

call npm run deploy:website

if errorlevel 1 (
    echo.
    echo ATTENZIONE:
    echo La release GitHub e stata creata correttamente,
    echo ma il deploy Firebase del sito e fallito.
    echo.
    echo Puoi riprovare manualmente con:
    echo     npm run deploy:website
    echo.
    goto :fail
)

REM ============================================================
REM COMPLETATO
REM ============================================================

echo.
echo ============================================================
echo   RELEASE FILEX SUITE COMPLETATA
echo ============================================================
echo.
echo Versione: %VERSION%
echo Tag:      %TAG%
echo Commit:   %LOCAL_SHA%
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
echo La FileX Suite gia installata dovrebbe ora rilevare
echo automaticamente la versione %VERSION%.
echo.
pause
exit /b 0


:abort
echo.
echo Operazione annullata.
echo Nessun tag di release e stato pubblicato da questo punto.
echo.
pause
exit /b 2


:fail
echo.
echo ============================================================
echo   RELEASE INTERROTTA
echo ============================================================
echo.

if "%RELEASE_DONE%"=="1" (
    echo NOTA:
    echo La release GitHub risulta gia completata.
    echo L'errore e avvenuto in una verifica successiva
    echo oppure durante il deploy del sito.
    echo.
)

if "%TAG_PUSHED%"=="1" if not "%RELEASE_DONE%"=="1" (
    echo ATTENZIONE:
    echo Il tag %TAG% e stato pubblicato su GitHub, ma la release
    echo NON risulta completata con successo ^(probabilmente la
    echo GitHub Action e fallita o e stata interrotta^).
    echo.
    echo Se non elimini il tag, un nuovo tentativo con la stessa
    echo versione fallira allo step "Verifica tag" perche il tag
    echo esiste gia.
    echo.
    choice /C SN /N /M "Vuoi eliminare ora il tag %TAG% ^(locale + GitHub^)? [S/N] "
    if not errorlevel 2 (
        echo.
        echo Rimozione tag locale...
        git tag -d "%TAG%" >nul 2>&1

        echo Rimozione tag remoto...
        git push origin ":refs/tags/%TAG%" >nul 2>&1

        if errorlevel 1 (
            echo ATTENZIONE: non sono riuscito a rimuovere il tag remoto.
            echo Rimuovilo manualmente con:
            echo     git push origin :refs/tags/%TAG%
        ) else (
            echo Tag %TAG% rimosso. Puoi ripetere la release.
        )
    ) else (
        echo.
        echo Tag NON rimosso. Per rimuoverlo manualmente in seguito:
        echo     git tag -d %TAG%
        echo     git push origin :refs/tags/%TAG%
    )
    echo.
)

echo Controlla il messaggio di errore sopra.
echo.
pause
exit /b 1