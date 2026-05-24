'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');

function getAppUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(
      path.join(path.dirname(app.getPath('exe')), 'sena-tracker.json'), 'utf8'
    ));
    if (cfg.url) return cfg.url;
  } catch {}
  return 'http://10.0.7.62:3000';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Sena Job Tracker',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(getAppUrl());

  // Open target="_blank" links in the default browser, not a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('pick-folder', async (_event, { label, defaultPath }) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: label || 'Select Folder',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('create-folder', async (_event, { parentPath, folderName, subfolders }) => {
  const target = path.join(parentPath, folderName);
  fs.mkdirSync(target, { recursive: true });
  for (const sub of (subfolders || [])) {
    fs.mkdirSync(path.join(target, sub), { recursive: true });
  }
  return target;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
