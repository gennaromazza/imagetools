const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('filexDesktop', {
  resizeSuiteLauncher: (height, width) => ipcRenderer.invoke('test:resize-launcher', height, width),
  getSuiteNotifications: async () => [{id:'send-1',toolId:'filex-send',title:'FileX Send',message:'2 file ricevuti · Cliente Test',createdAt:Date.now()}],
  getSuiteUpdateState: async () => ({status:'up-to-date'}),
  getLicenseState: async () => ({canUseTools:true}),
  listAvailableTools: async () => [
    {toolId:'image-party-frame', toolName:'Image Party Frame', installed:true, installedVersion:'1.0.0'},
    {toolId:'image-converter', toolName:'Image Converter', installed:true, installedVersion:'1.0.0',status:'update-available'},
    {toolId:'id-photo', toolName:'FileX ID Photo', installed:true, installedVersion:'1.0.0'},
    {toolId:'archivio-flow', toolName:'Archivio Flow', installed:true},
    {toolId:'filex-send', toolName:'FileX Send', installed:true},
    {toolId:'backup-guard', toolName:'Backup Guard', installed:false},
  ],
  openInstalledTool: async () => ({ok:false,message:'Licenza non attiva — errore di prova'}),
  openSuiteWindow: async () => {},
});
