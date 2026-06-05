const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = !app.isPackaged;
let viteProcess = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    show: false, // Don't show until ready-to-show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    // In dev, load from the vite server
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools();
  } else {
    // In prod, load the built file
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // Handle errors
  win.webContents.on('did-fail-load', () => {
    if (isDev) {
      console.log('Vite not ready yet, retrying in 1s...');
      setTimeout(() => win.loadURL('http://localhost:5173'), 1000);
    }
  });
}

app.whenReady().then(() => {
  if (isDev) {
    // Automatically start Vite dev server in development
    viteProcess = spawn('npm', ['run', 'dev'], {
      shell: true,
      stdio: 'inherit'
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (viteProcess) {
    viteProcess.kill();
  }
});
