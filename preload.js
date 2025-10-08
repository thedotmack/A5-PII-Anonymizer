const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Expose only specific IPC channels to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),
  selectInputDirectory: () => ipcRenderer.invoke('select-input-directory'),
  processFile: (filePath, outputDir) => ipcRenderer.invoke('process-file', { filePath, outputDir }),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  
  // File system operations needed by renderer
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', { filePath, data }),
  
  // Log messages
  onLogMessage: (callback) => ipcRenderer.on('log-message', (_event, msg) => callback(msg)),
  
  // Node APIs needed by renderer (safe wrappers)
  path: {
    join: (...args) => path.join(...args),
    extname: (p) => path.extname(p),
    basename: (p, ext) => path.basename(p, ext),
    dirname: (p) => path.dirname(p)
  },
  
  os: {
    tmpdir: () => os.tmpdir()
  },
  
  // Shell operations
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  }
});
