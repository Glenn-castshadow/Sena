'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');

// Config file sits next to the exe (packaged) or in the electron/ folder (dev)
const CONFIG_PATH = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'sena-tracker.json')
  : path.join(__dirname, 'sena-tracker.json');

const DEFAULT_URL = 'http://10.0.7.62:3000';

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {};
}

function getAppUrl() {
  return readConfig().url || DEFAULT_URL;
}

function saveUrl(url) {
  const cfg = readConfig();
  cfg.url = url;
  if (url !== DEFAULT_URL) cfg.ngrokUrl = url; // remember last Ngrok URL
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.round(width * 0.60),
    height: Math.round(height * 0.60),
    title: 'Sena Job Tracker',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(getAppUrl());
  win.once('ready-to-show', () => win.show());

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

ipcMain.handle('get-server-info', () => ({
  defaultUrl: DEFAULT_URL,
  currentUrl: getAppUrl(),
  ngrokUrl:   readConfig().ngrokUrl || '',
}));

ipcMain.handle('set-server-url', (_event, url) => {
  saveUrl(url);
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.loadURL(url);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
