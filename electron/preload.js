'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolder:    (label, defaultPath) => ipcRenderer.invoke('pick-folder', { label, defaultPath }),
  createFolder:  (parentPath, folderName, subfolders) => ipcRenderer.invoke('create-folder', { parentPath, folderName, subfolders }),
  getServerUrl:  () => ipcRenderer.invoke('get-server-url'),
  setServerUrl:  (url) => ipcRenderer.invoke('set-server-url', url),
});
