import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { FileProcessor } from './fileProcessor.js';
import { fileURLToPath } from 'url';

let isLLMInitialized = false; // track if LLM is loaded once

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Security: Validation functions for file paths
function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path');
  }
  
  // Check file exists
  if (!fs.existsSync(filePath)) {
    throw new Error('File does not exist');
  }
  
  // Resolve to absolute path and check for path traversal
  const realPath = fs.realpathSync(filePath);
  const userHome = os.homedir();
  
  // Only allow files in user's home directory
  if (!realPath.startsWith(userHome)) {
    throw new Error('Access denied: File must be in user directory');
  }
  
  // Check it's actually a file
  const stats = fs.statSync(realPath);
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }
  
  return realPath;
}

function validateDirectoryPath(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new Error('Invalid directory path');
  }
  
  // Check directory exists
  if (!fs.existsSync(dirPath)) {
    throw new Error('Directory does not exist');
  }
  
  // Resolve to absolute path
  const realPath = fs.realpathSync(dirPath);
  const userHome = os.homedir();
  
  // Only allow directories in user's home directory
  if (!realPath.startsWith(userHome)) {
    throw new Error('Access denied: Directory must be in user directory');
  }
  
  // Check it's actually a directory
  const stats = fs.statSync(realPath);
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }
  
  return realPath;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      nodeIntegration: false,           // Security: Disable Node.js in renderer
      contextIsolation: true,           // Security: Enable context isolation
      enableRemoteModule: false,        // Security: Disable remote module
      sandbox: true,                    // Security: Enable sandbox
      preload: path.join(__dirname, 'preload.js')  // Use preload script for IPC
    },
    backgroundColor: '#1a1a1a',
  });
  // mainWindow.webContents.openDevTools(); // uncomment if you want the console

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // macOS Dock icon
  if (process.platform === 'darwin') {
    if (app.isPackaged) {
      // In production, icon is inside resources/assets/icon.png
      const iconPath = path.join(process.resourcesPath, 'assets', 'icon.png');
      app.dock.setIcon(iconPath);
    } else {
      // In dev mode, use a local path
      const devIconPath = path.join(__dirname, 'assets', 'icon.png');
      app.dock.setIcon(devIconPath);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('select-output-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('select-input-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('process-file', async (event, { filePath, outputDir }) => {
  try {
    // Security: Validate inputs
    const validatedFilePath = validateFilePath(filePath);
    const validatedOutputDir = outputDir ? validateDirectoryPath(outputDir) : null;
    
    const fileName = path.basename(validatedFilePath);

    // If LLM not yet loaded, notify the renderer
    if (!isLLMInitialized) {
      mainWindow.webContents.send('log-message', "Initializing LLM (first-time load)...");
    }

    mainWindow.webContents.send('log-message', `Processing: ${fileName}`);

    const directory = validatedOutputDir || path.dirname(validatedFilePath);
    const newFileName = FileProcessor.generateOutputFileName(fileName);
    const outputPath = path.join(directory, newFileName);

    await FileProcessor.processFile(validatedFilePath, outputPath);

    // Mark LLM as initialized after first file
    isLLMInitialized = true;

    mainWindow.webContents.send('log-message', `Finished: ${fileName}`);
    return { success: true, outputPath };
  } catch (error) {
    console.error("Error in process-file IPC:", error);
    mainWindow.webContents.send('log-message', `Error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Open a folder or URL with security validation
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') {
    console.error('Invalid folder path');
    return;
  }
  
  // Check if it's a URL
  if (folderPath.startsWith('http://') || folderPath.startsWith('https://')) {
    // Security: Whitelist allowed domains
    const allowedDomains = ['amicus5.com'];
    
    try {
      const url = new URL(folderPath);
      const isAllowed = allowedDomains.some(domain => 
        url.hostname === domain || url.hostname.endsWith('.' + domain)
      );
      
      if (!isAllowed) {
        console.error('Domain not in whitelist:', url.hostname);
        return;
      }
      
      shell.openExternal(folderPath);
    } catch (err) {
      console.error('Invalid URL:', err);
    }
  } else {
    // Security: Validate local path
    try {
      const validatedPath = validateDirectoryPath(folderPath);
      shell.openPath(validatedPath);
    } catch (err) {
      console.error('Invalid path:', err);
    }
  }
});

// Additional IPC handlers for file system operations (used by preload.js)
ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    const validatedPath = validateDirectoryPath(dirPath);
    const files = fs.readdirSync(validatedPath);
    return files;
  } catch (error) {
    console.error('Error reading directory:', error);
    throw error;
  }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    // Allow stats without strict validation for checking if paths exist
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const stats = fs.statSync(filePath);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size
    };
  } catch (error) {
    console.error('Error getting file stats:', error);
    return null;
  }
});

ipcMain.handle('write-file', async (event, { filePath, data }) => {
  try {
    // Validate parent directory exists and is in user home
    const dirPath = path.dirname(filePath);
    const validatedDir = validateDirectoryPath(dirPath);
    const finalPath = path.join(validatedDir, path.basename(filePath));
    
    fs.writeFileSync(finalPath, data);
    return { success: true };
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
  }
});

ipcMain.handle('shell-open-external', async (event, url) => {
  // Reuse the validation from open-folder
  if (!url || typeof url !== 'string') {
    console.error('Invalid URL');
    return;
  }
  
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const allowedDomains = ['amicus5.com'];
    
    try {
      const urlObj = new URL(url);
      const isAllowed = allowedDomains.some(domain => 
        urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
      );
      
      if (!isAllowed) {
        console.error('Domain not in whitelist:', urlObj.hostname);
        return;
      }
      
      shell.openExternal(url);
    } catch (err) {
      console.error('Invalid URL:', err);
    }
  }
});
