import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { FileProcessor } from './fileProcessor.js';
import { fileURLToPath } from 'url';

let isLLMInitialized = false; // track if LLM is loaded once

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
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
    const fileName = path.basename(filePath);

    // If LLM not yet loaded, notify the renderer
    if (!isLLMInitialized) {
      mainWindow.webContents.send('log-message', "Initializing LLM (first-time load)...");
    }

    mainWindow.webContents.send('log-message', `Processing: ${fileName}`);

    const directory = outputDir || path.dirname(filePath);
    const newFileName = FileProcessor.generateOutputFileName(fileName);
    const outputPath = path.join(directory, newFileName);

    await FileProcessor.processFile(filePath, outputPath);

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

// Open a folder or URL
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (folderPath) {
    // If it looks like a URL (starts with http or https), open in external browser
    if (folderPath.startsWith('http')) {
      shell.openExternal(folderPath);
    } else {
      // Otherwise, treat as a local file path
      shell.openPath(folderPath);
    }
  }
});
