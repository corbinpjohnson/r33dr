const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const summaryHelperPath = app.isPackaged
  ? path.join(process.resourcesPath, 'SummaryHelper')
  : path.join(__dirname, 'bin', 'SummaryHelper');

ipcMain.handle('summarize-chapter', (_event, { text, chapterTitle }) => {
  return new Promise((resolve) => {
    if (!fs.existsSync(summaryHelperPath)) {
      resolve({ summary: null, chunkCount: null, error: 'Summary helper not built — run: npm run build:swift' });
      return;
    }
    const child = execFile(summaryHelperPath, [], { timeout: 120_000 }, (err, stdout) => {
      if (err) { resolve({ summary: null, chunkCount: null, error: err.message }); return; }
      try { resolve(JSON.parse(stdout)); }
      catch { resolve({ summary: null, chunkCount: null, error: 'Malformed response from summary helper' }); }
    });
    child.stdin.write(JSON.stringify({ text, chapterTitle: chapterTitle ?? '' }));
    child.stdin.end();
  });
});

ipcMain.handle('read-notes', (_event, notesPath) => {
  try {
    return fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : null;
  } catch { return null; }
});

ipcMain.handle('write-notes', (_event, { notesPath, content }) => {
  try {
    fs.writeFileSync(notesPath, content, 'utf8');
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('read-file', async (_event, filePath) => {
  const buf = fs.readFileSync(filePath);
  // Transfer the underlying ArrayBuffer so it can be used directly in the renderer.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
const isDev = !app.isPackaged;
let viteProcess = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 850,
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 8, y: 10 },
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
