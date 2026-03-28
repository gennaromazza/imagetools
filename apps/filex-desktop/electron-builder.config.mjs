import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDesktopToolOrDefault } from "./dist-electron/tool-manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requestedTool = getDesktopToolOrDefault(process.env.FILEX_TOOL);
const iconBasePath = join(__dirname, "build", "branding", requestedTool.id);
const nsisIncludePath = join(__dirname, "build", "generated-installer-hooks.nsh");

function escapeNsisString(value) {
  return value.replace(/\$/g, "$$").replace(/"/g, '$\\"');
}

function buildNsisIncludeContent(tool) {
  const displayNames = Array.from(
    new Set([tool.productName, ...(tool.legacyUpgradeDisplayNames ?? [])].filter(Boolean)),
  );
  const shortcutIconPath = `$INSTDIR\\resources\\branding\\${tool.id}.ico`;
  const shouldInstallExplorerContextMenu = tool.id === "photo-selector-app";
  const explorerContextMenuLabel = escapeNsisString(`Apri con ${tool.productName}`);
  const explorerContextMenuKey = "Software\\\\Classes\\\\Directory\\\\shell\\\\FileXPhotoSelectorOpen";
  const explorerFolderContextMenuKey = "Software\\\\Classes\\\\Folder\\\\shell\\\\FileXPhotoSelectorOpen";
  const explorerBackgroundContextMenuKey =
    "Software\\\\Classes\\\\Directory\\\\Background\\\\shell\\\\FileXPhotoSelectorOpen";

  const pushLines = displayNames
    .map((displayName) => `  Push "${escapeNsisString(displayName)}"\n  Call uninstallByDisplayName`)
    .join("\n");
  const contextMenuInstallLines = shouldInstallExplorerContextMenu
    ? `  WriteRegStr HKCU "${explorerContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%1"'
  WriteRegStr HKCU "${explorerFolderContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerFolderContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerFolderContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%1"'
  WriteRegStr HKCU "${explorerBackgroundContextMenuKey}" "" "${explorerContextMenuLabel}"
  WriteRegStr HKCU "${explorerBackgroundContextMenuKey}" "Icon" "$appExe"
  WriteRegStr HKCU "${explorerBackgroundContextMenuKey}\\\\command" "" '"$appExe" --open-folder "%V"'
`
    : "  ; Nessun menu contestuale Explorer per questo tool.\n";
  const contextMenuUninstallLines = shouldInstallExplorerContextMenu
    ? `  DeleteRegKey HKCU "${explorerBackgroundContextMenuKey}"
  DeleteRegKey HKCU "${explorerFolderContextMenuKey}"
  DeleteRegKey HKCU "${explorerContextMenuKey}"
`
    : "  ; Nessun menu contestuale Explorer da rimuovere.\n";

  return `!ifndef BUILD_UNINSTALLER
!macro customInit
  Call uninstallLegacyVersions
!macroend

Function uninstallLegacyVersions
${pushLines || "  ; No legacy display names configured."}
FunctionEnd

Function uninstallByDisplayName
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5

  SetRegView 64
  Call uninstallByDisplayNameCurrentView
  SetRegView 32
  Call uninstallByDisplayNameCurrentView

  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function uninstallByDisplayNameCurrentView
  StrCpy $1 0

  loop_hkcu:
    EnumRegKey $2 HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall" $1
    StrCmp $2 "" loop_hklm_start
    ReadRegStr $3 HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\$2" "DisplayName"
    StrCmp $3 $0 0 next_hkcu
    ReadRegStr $4 HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\$2" "QuietUninstallString"
    ReadRegStr $5 HKCU "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\$2" "UninstallString"
    StrCmp $4 "" 0 run_hkcu
    StrCmp $5 "" next_hkcu
    StrCpy $4 '$5 /S'
  run_hkcu:
    DetailPrint "Rimuovo installazione precedente: $3"
    ExecWait '$4'
  next_hkcu:
    IntOp $1 $1 + 1
    Goto loop_hkcu

  loop_hklm_start:
    StrCpy $1 0

  loop_hklm:
    EnumRegKey $2 HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall" $1
    StrCmp $2 "" uninstall_done
    ReadRegStr $3 HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\$2" "DisplayName"
    StrCmp $3 $0 0 next_hklm
    ReadRegStr $4 HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\$2" "QuietUninstallString"
    ReadRegStr $5 HKLM "Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\$2" "UninstallString"
    StrCmp $4 "" 0 run_hklm
    StrCmp $5 "" next_hklm
    StrCpy $4 '$5 /S'
  run_hklm:
    DetailPrint "Rimuovo installazione precedente: $3"
    ExecWait '$4'
  next_hklm:
    IntOp $1 $1 + 1
    Goto loop_hklm

  uninstall_done:
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

mkdirSync(join(__dirname, "build"), { recursive: true });
writeFileSync(nsisIncludePath, buildNsisIncludeContent(requestedTool), "utf8");

export default {
  appId: `studio.filex.${requestedTool.id}`,
  productName: requestedTool.productName,
  executableName: requestedTool.executableName,
  asar: true,
  asarUnpack: [
    "**/node_modules/exiftool-vendored.exe/**",
    "**/node_modules/exiftool-vendored.pl/**",
  ],
  npmRebuild: false,
  buildDependenciesFromSource: false,
  directories: {
    output: "release",
  },
  files: [
    "dist-electron/**/*",
    "package.json",
  ],
  extraResources: [
    {
      from: requestedTool.workspaceDistDirRelativeToShell,
      to: requestedTool.packagedDistDir,
      filter: ["**/*"],
    },
    {
      from: `${iconBasePath}.png`,
      to: `branding/${requestedTool.id}.png`,
    },
    {
      from: `${iconBasePath}.ico`,
      to: `branding/${requestedTool.id}.ico`,
    },
  ],
  win: {
    icon: `${iconBasePath}.ico`,
    signAndEditExecutable: false,
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    artifactName: `${requestedTool.executableName}-\${version}-\${arch}-setup.\${ext}`,
  },
  mac: {
    icon: `${iconBasePath}.icns`,
    category: "public.app-category.photography",
    target: [
      {
        target: "dmg",
        arch: ["universal"],
      },
      {
        target: "zip",
        arch: ["universal"],
      },
    ],
    artifactName: `${requestedTool.executableName}-\${version}-\${arch}.\${ext}`,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    uninstallDisplayName: requestedTool.productName,
    installerIcon: `${iconBasePath}.ico`,
    uninstallerIcon: `${iconBasePath}.ico`,
    installerHeaderIcon: `${iconBasePath}.ico`,
    shortcutName: requestedTool.productName,
    include: nsisIncludePath,
  },
  dmg: {
    title: `${requestedTool.productName} Installer`,
  },
};
