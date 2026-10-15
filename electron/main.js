const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const { ResultStore } = require('../src/store/resultStore');

let mainWindow = null;
let worker = null;
let ratesWorker = null;
let storeDir = null;

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'CSV Mapper',
    backgroundColor: '#F1F5F9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function stopWorker() {
  if (worker) {
    worker.postMessage({ type: 'cancel' });
    worker.terminate().catch(() => {});
    worker = null;
  }
}

function stopRatesWorker() {
  if (ratesWorker) {
    ratesWorker.postMessage({ type: 'cancel' });
    ratesWorker.terminate().catch(() => {});
    ratesWorker = null;
  }
}

function ratesStateDir() {
  // Persistente tra un upload e l'altro (hash sezione + index per riga)
  const dir = path.join(app.getPath('userData'), 'rates-br-state');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function startRatesWorker(filePath) {
  stopRatesWorker();

  ratesWorker = new Worker(path.join(__dirname, '..', 'src', 'worker', 'ratesHeatmap.js'), {
    workerData: { filePath, stateDir: ratesStateDir() },
  });

  ratesWorker.on('message', (msg) => {
    send('rates:event', msg);
    if (msg.type === 'done' || msg.type === 'error' || msg.type === 'cancelled') {
      ratesWorker = null;
    }
  });

  ratesWorker.on('error', (err) => {
    send('rates:event', { type: 'error', message: err.message });
    ratesWorker = null;
  });

  ratesWorker.on('exit', (code) => {
    if (code !== 0 && ratesWorker) {
      send('rates:event', { type: 'error', message: `Rates worker exited with code ${code}` });
    }
    ratesWorker = null;
  });
}

function startWorker(filePath) {
  stopWorker();

  const base = path.join(os.tmpdir(), 'csv-mapper');
  fs.mkdirSync(base, { recursive: true });
  storeDir = path.join(base, `job-${Date.now()}`);
  fs.mkdirSync(storeDir, { recursive: true });

  worker = new Worker(path.join(__dirname, '..', 'src', 'worker', 'csvProcessor.js'), {
    workerData: { filePath, storeDir },
  });

  worker.on('message', (msg) => {
    send('process:event', msg);
    if (msg.type === 'done' || msg.type === 'error' || msg.type === 'cancelled') {
      worker = null;
    }
  });

  worker.on('error', (err) => {
    send('process:event', { type: 'error', message: err.message });
    worker = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0 && worker) {
      send('process:event', { type: 'error', message: `Worker exited with code ${code}` });
    }
    worker = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopWorker();
  stopRatesWorker();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:openCsv', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open CSV file',
    filters: [
      { name: 'CSV', extensions: ['csv', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (canceled || !filePaths?.[0]) return null;

  const filePath = filePaths[0];
  const stat = fs.statSync(filePath);

  if (stat.size > MAX_FILE_BYTES) {
    return {
      error: `File too large (${(stat.size / 1024 ** 3).toFixed(2)} GB). Max is 2 GB.`,
    };
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
  };
});

ipcMain.handle('process:start', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found' };
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'File exceeds 2 GB limit' };
  }
  startWorker(filePath);
  return { ok: true };
});

ipcMain.handle('process:cancel', async () => {
  stopWorker();
  send('process:event', { type: 'cancelled' });
  return { ok: true };
});

ipcMain.handle('results:getPage', async (_event, { offset = 0, limit = 100 } = {}) => {
  if (!storeDir || !fs.existsSync(path.join(storeDir, 'meta.json'))) {
    return { rows: [], total: 0, columns: [] };
  }

  const store = new ResultStore(storeDir).open();
  try {
    return store.getPage(offset, limit);
  } finally {
    store.close();
  }
});

ipcMain.handle('rates:start', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found' };
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'File exceeds 2 GB limit' };
  }
  startRatesWorker(filePath);
  return { ok: true };
});

ipcMain.handle('rates:cancel', async () => {
  stopRatesWorker();
  send('rates:event', { type: 'cancelled' });
  return { ok: true };
});

ipcMain.handle('rates:openState', async () => {
  const dir = ratesStateDir();
  const err = await shell.openPath(dir);
  if (err) return { ok: false, error: err };
  return { ok: true, path: dir };
});

ipcMain.handle('results:export', async () => {
  if (!storeDir || !fs.existsSync(path.join(storeDir, 'meta.json'))) {
    return { ok: false, error: 'No results to export' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export processed CSV',
    defaultPath: 'mapped.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });

  if (canceled || !filePath) return { ok: false, cancelled: true };

  const store = new ResultStore(storeDir).open();
  try {
    await store.exportCsv(filePath, (progress) => {
      send('export:event', { type: 'progress', ...progress });
    });
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    store.close();
  }
});
