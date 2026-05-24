'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolder: (label, defaultPath) =>
    ipcRenderer.invoke('pick-folder', { label, defaultPath }),
  createFolder: (parentPath, folderName, subfolders) =>
    ipcRenderer.invoke('create-folder', { parentPath, folderName, subfolders }),
});
