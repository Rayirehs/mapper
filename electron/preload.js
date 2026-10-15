const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('csvMapper', {
  openCsv: () => ipcRenderer.invoke('dialog:openCsv'),
  startProcess: (filePath) => ipcRenderer.invoke('process:start', filePath),
  cancelProcess: () => ipcRenderer.invoke('process:cancel'),
  getPage: (offset, limit) => ipcRenderer.invoke('results:getPage', { offset, limit }),
  exportCsv: () => ipcRenderer.invoke('results:export'),
  startRatesHeatmap: (filePath) => ipcRenderer.invoke('rates:start', filePath),
  cancelRatesHeatmap: () => ipcRenderer.invoke('rates:cancel'),
  openRatesState: () => ipcRenderer.invoke('rates:openState'),
  onProcessEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('process:event', handler);
    return () => ipcRenderer.removeListener('process:event', handler);
  },
  onRatesEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('rates:event', handler);
    return () => ipcRenderer.removeListener('rates:event', handler);
  },
  onExportEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('export:event', handler);
    return () => ipcRenderer.removeListener('export:event', handler);
  },
});
