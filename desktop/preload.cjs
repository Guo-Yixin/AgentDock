const {contextBridge,ipcRenderer}=require('electron');
// Each exposed capability has a fixed IPC channel; no filesystem or shell API.
contextBridge.exposeInMainWorld('agentdock',Object.freeze({
 preferences:()=>ipcRenderer.invoke('ad:preferences'),
 setPreferences:value=>ipcRenderer.invoke('ad:set-preferences',value),
 chooseSource:id=>ipcRenderer.invoke('ad:choose-source',id),
 importSettings:()=>ipcRenderer.invoke('ad:import-settings'),
 checkUpdate:()=>ipcRenderer.invoke('ad:check-update'),
 openDownloads:()=>ipcRenderer.invoke('ad:open-downloads'),
 retry:()=>ipcRenderer.invoke('ad:retry')
}));
