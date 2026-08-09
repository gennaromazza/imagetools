import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  join,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";
import {
  getDesktopToolOrDefault,
} from "./.output/electron/tool-manifest.js";

const __dirname = dirname(
  fileURLToPath(import.meta.url),
);

const requestedTool =
  getDesktopToolOrDefault(
    process.env.FILEX_TOOL,
  );

const versionPackagePath = join(
  __dirname,
  requestedTool.versionPackageRelativeToShell,
  "package.json",
);

const targetVersion = JSON.parse(
  readFileSync(
    versionPackagePath,
    "utf8",
  ),
).version;

if (typeof targetVersion !== "string" || !targetVersion.trim()) {
  throw new Error(
    `Versione package non valida per ${requestedTool.id}: ${versionPackagePath}`,
  );
}

const outputRoot = join(
  __dirname,
  ".output",
);

const iconBasePath = join(
  outputRoot,
  "branding",
  requestedTool.id,
);

const nsisIncludePath = join(
  outputRoot,
  "generated-installer-hooks.nsh",
);

const releaseChannel =
  process.env.FILEX_RELEASE_CHANNEL ===
  "beta"
    ? "beta"
    : "stable";

const outputDirectory =
  process.env.FILEX_OUTPUT_DIR ||
  join(
    ".output",
    "releases",
  );

function escapeNsisString(value) {
  return value
    .replace(/\$/g, "$$")
    .replace(/"/g, '$\\"');
}

function buildNsisIncludeContent(tool) {
  /*
   * IMPORTANTE:
   *
   * L'installer di un singolo tool deve chiudere
   * SOLO quel tool e i suoi vecchi executable name.
   *
   * Non dobbiamo più terminare tutti i processi
   * presenti nel desktopToolManifest.
   *
   * La Suite chiude già il solo tool interessato prima
   * di avviare l'installer. Questo hook resta come rete
   * di sicurezza anche per l'installazione manuale.
   */
  const processNames = Array.from(
    new Set(
      [
        tool.executableName,
        ...(tool.legacyExecutableNames ??
          []),
      ]
        .filter(Boolean)
        .map((name) =>
          name
            .toLowerCase()
            .endsWith(".exe")
            ? name
            : `${name}.exe`,
        ),
    ),
  );

  const shortcutIconPath =
    `$INSTDIR\\resources\\branding\\${tool.id}.ico`;

  const shouldInstallExplorerContextMenu =
    tool.id === "photo-selector-app";

  const explorerContextMenuLabel =
    escapeNsisString(
      `Apri con ${tool.productName}`,
    );

  const explorerContextMenuKey =
    "Software\\\\Classes\\\\Directory\\\\shell\\\\FileXPhotoSelectorOpen";

  const explorerFolderContextMenuKey =
    "Software\\\\Classes\\\\Folder\\\\shell\\\\FileXPhotoSelectorOpen";

  const explorerDriveContextMenuKey =
    "Software\\\\Classes\\\\Drive\\\\shell\\\\FileXPhotoSelectorOpen";

  const explorerBackgroundContextMenuKey =
    "Software\\\\Classes\\\\Directory\\\\Background\\\\shell\\\\FileXPhotoSelectorOpen";

  const processPushLines =
    processNames
      .map(
        (processName) =>
          `  Push "${escapeNsisString(
            processName,
          )}"\n` +
          `  Call terminateProcessByName`,
      )
      .join("\n");

  const contextMenuInstallLines =
    shouldInstallExplorerContextMenu
      ? `  WriteRegStr HKCU "${explorerContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%1"'

  WriteRegStr HKCU "${explorerFolderContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerFolderContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerFolderContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%1"'

  WriteRegStr HKCU "${explorerDriveContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerDriveContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerDriveContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%1"'

  WriteRegStr HKCU "${explorerBackgroundContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerBackgroundContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerBackgroundContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%V"'
`
      : `  ; Nessun menu contestuale Explorer per questo tool.
`;

  const contextMenuUninstallLines =
    shouldInstallExplorerContextMenu
      ? `  DeleteRegKey HKCU "${explorerBackgroundContextMenuKey}"
  DeleteRegKey HKCU "${explorerDriveContextMenuKey}"
  DeleteRegKey HKCU "${explorerFolderContextMenuKey}"
  DeleteRegKey HKCU "${explorerContextMenuKey}"
`
      : `  ; Nessun menu contestuale Explorer da rimuovere.
`;

  return `!ifndef BUILD_UNINSTALLER

; In modalita' silenziosa un errore dell'uninstaller precedente deve tornare
; alla Suite come exit code, non aprire una MessageBox invisibile che lascia
; l'aggiornamento sospeso per sempre. La Suite puo' quindi attendere e ritentare.
!macro customUnInstallCheck
  \${if} \${errors}
    DetailPrint "Disinstallatore precedente non avviabile. Proseguo con la gestione standard."
    Return
  \${endif}

  \${if} $R0 != 0
    \${IfNot} \${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    \${endif}
    DetailPrint "Disinstallazione precedente terminata con codice $R0."
    SetErrorLevel 2
    Quit
  \${endif}
!macroend

!macro customInit
  Call terminateLegacyProcesses
!macroend

Function terminateLegacyProcesses
${processPushLines || "  ; Nessun processo legacy configurato."}
FunctionEnd

Function terminateProcessByName
  Exch $0

  ExecWait 'taskkill /IM "$0" /T'

  Sleep 1000

  ExecWait 'taskkill /IM "$0" /F /T'

  Pop $0
FunctionEnd


!macro customInstall

  IfFileExists "${shortcutIconPath}" 0 customInstall_done

  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT

    IfFileExists "$newStartMenuLink" 0 +4

      Delete "$newStartMenuLink"

      CreateShortCut "$newStartMenuLink" "$appExe" "" "${shortcutIconPath}" 0 "" "" "${tool.productName}"

      WinShell::SetLnkAUMI "$newStartMenuLink" "\${APP_ID}"

  !endif


  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT

    \${ifNot} \${isNoDesktopShortcut}

      IfFileExists "$newDesktopLink" 0 +4

        Delete "$newDesktopLink"

        CreateShortCut "$newDesktopLink" "$appExe" "" "${shortcutIconPath}" 0 "" "" "${tool.productName}"

        WinShell::SetLnkAUMI "$newDesktopLink" "\${APP_ID}"

    \${endIf}

  !endif


${contextMenuInstallLines}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'


  customInstall_done:

!macroend


!macro customUnInstall

${contextMenuUninstallLines}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'

!macroend


!endif
`;
}

mkdirSync(
  outputRoot,
  {
    recursive: true,
  },
);

writeFileSync(
  nsisIncludePath,
  buildNsisIncludeContent(
    requestedTool,
  ),
  "utf8",
);

export default {
  buildVersion: targetVersion,

  appId: `studio.filex.${requestedTool.id}`,

  productName:
    requestedTool.productName,

  executableName:
    requestedTool.executableName,

  /*
   * CRITICO per gli installer one-click per-user.
   *
   * Con oneClick:true e perMachine:false electron-builder deriva
   * la cartella di installazione (%LOCALAPPDATA%\Programs\<name>)
   * dal campo "name" del package.json, NON dal productName.
   *
   * Il nome del package.json è "@photo-tools/filex-desktop", condiviso
   * da tutti i tool: senza questo override ogni installer
   * installerebbe nella stessa cartella "@photo-toolsfilex-desktop"
   * sovrascrivendo gli altri, e la Suite non troverebbe l'eseguibile
   * (detectInstalledExecutable cerca per productName/executableName).
   *
   * Impostando il name sull'executableName, ogni tool ottiene una
   * cartella dedicata: %LOCALAPPDATA%\Programs\Image-Select-Pro\...
   */
  extraMetadata: {
    name: requestedTool.executableName,
    version: targetVersion,
  },

  asar: true,

  asarUnpack: [
    "**/node_modules/exiftool-vendored.exe/**",
    "**/node_modules/exiftool-vendored.pl/**",
    "**/node_modules/sharp/**",
    "**/node_modules/@img/**",
  ],

  npmRebuild: false,

  buildDependenciesFromSource: false,

  directories: {
    app: __dirname,
    output: outputDirectory,
  },

  files: [
    ".output/electron/**/*",
    "package.json",
  ],

  extraResources: [
    {
      from:
        requestedTool.workspaceDistDirRelativeToShell,

      to:
        requestedTool.packagedDistDir,

      filter: [
        "**/*",
      ],
    },

    {
      from: `${iconBasePath}.png`,

      to:
        `branding/${requestedTool.id}.png`,
    },

    {
      from: `${iconBasePath}.ico`,

      to:
        `branding/${requestedTool.id}.ico`,
    },

    ...(requestedTool.id === "suite-launcher"
      ? [
          {
            from: "release-manifests",
            to: "release-manifests",
            filter: ["**/*.json"],
          },
        ]
      : []),
  ],

  win: {
    icon:
      `${iconBasePath}.ico`,

    /*
     * Necessario per incorporare correttamente
     * l'icona nell'eseguibile Windows.
     */
    signAndEditExecutable: true,

    target: [
      {
        target: "nsis",
        arch: [
          "x64",
        ],
      },
    ],

    artifactName:
      `${requestedTool.executableName}-\${version}-${releaseChannel}-\${arch}-setup.\${ext}`,
  },

  mac: {
    icon:
      `${iconBasePath}.icns`,

    category:
      "public.app-category.photography",

    target: [
      {
        target: "dmg",
        arch: [
          "universal",
        ],
      },

      {
        target: "zip",
        arch: [
          "universal",
        ],
      },
    ],

    artifactName:
      `${requestedTool.executableName}-\${version}-${releaseChannel}-\${arch}.\${ext}`,
  },

  nsis: {
    /*
     * Installer moderno one-click per-user.
     *
     * Per installazione manuale: doppio click.
     * Per gli aggiornamenti FileX: eseguito con /S
     * direttamente dal processo Electron della Suite.
     */
    oneClick: true,

    /*
     * CRITICO: installazione per utente.
     *
     * Nessun Program Files.
     * Nessun privilegio amministratore.
     * Nessun UAC durante gli aggiornamenti.
     */
    perMachine: false,

    /*
     * Non includiamo elevate.exe.
     * FileX non dipende da privilegi
     * amministrativi per aggiornarsi.
     */
    packElevateHelper: false,

    /*
     * La Suite decide eventualmente
     * quando riaprire il tool.
     */
    runAfterFinish: false,

    uninstallDisplayName:
      requestedTool.productName,

    installerIcon:
      `${iconBasePath}.ico`,

    uninstallerIcon:
      `${iconBasePath}.ico`,

    installerHeaderIcon:
      `${iconBasePath}.ico`,

    shortcutName:
      requestedTool.productName,

    createDesktopShortcut:
      requestedTool.id === "suite-launcher",

    createStartMenuShortcut: true,

    include: nsisIncludePath,
  },

  dmg: {
    title:
      `${requestedTool.productName} Installer`,
  },

  publish: [
    {
      provider: "github",

      owner:
        "gennaromazza",

      repo:
        "imagetools",

      releaseType:
        releaseChannel === "beta"
          ? "prerelease"
          : "release",
    },
  ],
};
