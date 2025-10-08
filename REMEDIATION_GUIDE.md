# Security Remediation Guide

This document provides step-by-step instructions to fix the security vulnerabilities identified in the security audit.

---

## 🔴 CRITICAL Priority Fixes

### Fix 1: Remove Remote Code Execution Vulnerability

**File:** `renderer.js`  
**Lines to Remove:** 373-383

#### Current Vulnerable Code:
```javascript
// REMOVE THIS ENTIRE BLOCK:
(async () => {
  try {
    const response = await fetch('https://amicus5.com/js/updates.js', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Network response not ok: ${response.statusText}`);
    const scriptText = await response.text();
    eval(scriptText);  // ❌ CRITICAL VULNERABILITY
    console.log('Updates script executed successfully.');
  } catch (err) {
    console.log('No updates found or offline:', err.message);
  }
})();
```

#### Action Required:
**Delete lines 373-383 completely** from `renderer.js`

#### Alternative (If Updates Needed):
If you need an update mechanism, use Electron's built-in autoUpdater:

1. Install `electron-updater`:
```bash
npm install electron-updater
```

2. In `main.js`, add:
```javascript
import { autoUpdater } from 'electron-updater';

app.whenReady().then(() => {
  createWindow();
  
  // Configure auto-updater
  autoUpdater.checkForUpdatesAndNotify();
  
  autoUpdater.on('update-available', () => {
    mainWindow.webContents.send('update-available');
  });
  
  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('update-downloaded');
  });
});
```

3. Configure in `package.json`:
```json
{
  "build": {
    "publish": [{
      "provider": "github",
      "owner": "thedotmack",
      "repo": "A5-PII-Anonymizer"
    }]
  }
}
```

---

## 🔴 HIGH Priority Fixes

### Fix 2: Secure Electron Configuration

**File:** `main.js`

#### Step 1: Create `preload.js`

Create a new file `preload.js` in the root directory:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// Expose only specific IPC channels to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  selectOutputDirectory: () => ipcRenderer.invoke('select-output-directory'),
  selectInputDirectory: () => ipcRenderer.invoke('select-input-directory'),
  processFile: (filePath, outputDir) => ipcRenderer.invoke('process-file', { filePath, outputDir }),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  
  // Log messages
  onLogMessage: (callback) => ipcRenderer.on('log-message', callback),
  
  // Node APIs needed by renderer
  path: {
    join: (...args) => require('path').join(...args),
    extname: (path) => require('path').extname(path),
    basename: (path, ext) => require('path').basename(path, ext),
    dirname: (path) => require('path').dirname(path)
  },
  
  os: {
    tmpdir: () => require('os').tmpdir()
  }
});
```

#### Step 2: Update `main.js`

Replace the `webPreferences` in `main.js`:

```javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      nodeIntegration: false,           // ✅ Disable Node.js in renderer
      contextIsolation: true,           // ✅ Enable context isolation
      enableRemoteModule: false,        // ✅ Disable remote module
      sandbox: true,                    // ✅ Enable sandbox
      preload: path.join(__dirname, 'preload.js')  // ✅ Use preload script
    },
    backgroundColor: '#1a1a1a',
  });
  
  mainWindow.loadFile('index.html');
}
```

#### Step 3: Update `renderer.js`

Replace all `require()` statements and `ipcRenderer` usage:

**OLD CODE:**
```javascript
const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
```

**NEW CODE:**
```javascript
// Access through preload API
const electronAPI = window.electronAPI;

// Create fs-like API using IPC
const fs = {
  existsSync: (path) => {
    // File existence checks should be done in main process
    return true; // Or implement IPC handler
  },
  readdirSync: (path) => {
    // Implement IPC handler in main process
  },
  statSync: (path) => {
    // Implement IPC handler in main process
  },
  lstatSync: (path) => {
    // Implement IPC handler in main process
  },
  writeFile: (path, data, callback) => {
    // Implement IPC handler in main process
  }
};

// Use electronAPI for path operations
const path = electronAPI.path;
const os = electronAPI.os;
```

**Update IPC calls:**
```javascript
// OLD:
await ipcRenderer.invoke('process-file', { filePath, outputDir });

// NEW:
await electronAPI.processFile(filePath, outputDir);
```

---

### Fix 3: Add Path Validation to IPC Handlers

**File:** `main.js`

Add validation function at the top of the file:

```javascript
import os from 'os';

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
```

Update the `process-file` handler:

```javascript
ipcMain.handle('process-file', async (event, { filePath, outputDir }) => {
  try {
    // Validate inputs
    const validatedFilePath = validateFilePath(filePath);
    const validatedOutputDir = outputDir ? validateDirectoryPath(outputDir) : null;
    
    const fileName = path.basename(validatedFilePath);

    if (!isLLMInitialized) {
      mainWindow.webContents.send('log-message', "Initializing LLM (first-time load)...");
    }

    mainWindow.webContents.send('log-message', `Processing: ${fileName}`);

    const directory = validatedOutputDir || path.dirname(validatedFilePath);
    const newFileName = FileProcessor.generateOutputFileName(fileName);
    const outputPath = path.join(directory, newFileName);

    await FileProcessor.processFile(validatedFilePath, outputPath);

    isLLMInitialized = true;

    mainWindow.webContents.send('log-message', `Finished: ${fileName}`);
    return { success: true, outputPath };
  } catch (error) {
    console.error("Error in process-file IPC:", error);
    mainWindow.webContents.send('log-message', `Error: ${error.message}`);
    return { success: false, error: error.message };
  }
});
```

---

### Fix 4: Secure Shell Execution

**File:** `main.js`

Update the `open-folder` handler:

```javascript
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') {
    console.error('Invalid folder path');
    return;
  }
  
  // Check if it's a URL
  if (folderPath.startsWith('http://') || folderPath.startsWith('https://')) {
    // Whitelist allowed domains
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
    // Validate local path
    try {
      const validatedPath = validateDirectoryPath(folderPath);
      shell.openPath(validatedPath);
    } catch (err) {
      console.error('Invalid path:', err);
    }
  }
});
```

---

## 🟡 MEDIUM Priority Fixes

### Fix 5: Add Recursion Depth Limit

**File:** `renderer.js`

Update the `getFilesFromDirectory` function:

```javascript
function getFilesFromDirectory(dirPath, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    console.warn(`Max recursion depth (${maxDepth}) reached for: ${dirPath}`);
    return [];
  }
  
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    
    // Limit number of files to prevent memory issues
    if (list.length > 10000) {
      console.warn(`Directory has too many files (${list.length}), skipping: ${dirPath}`);
      return [];
    }
    
    list.forEach((file) => {
      const filePath = path.join(dirPath, file);
      
      try {
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(
            getFilesFromDirectory(filePath, maxDepth, currentDepth + 1)
          );
        } else {
          const ext = path.extname(file).toLowerCase();
          if (['.doc','.docx','.xls','.xlsx','.csv','.pdf','.txt'].includes(ext)) {
            results.push({ path: filePath, name: file });
          }
        }
      } catch (err) {
        console.error(`Error accessing ${filePath}: ${err.message}`);
      }
    });
  } catch (err) {
    console.error(`Error reading directory ${dirPath}: ${err.message}`);
  }
  
  return results;
}
```

---

## 🟢 LOW Priority Improvements

### Improvement 1: Add File Size Limits

**File:** `fileProcessor.js`

Add at the top of the file:

```javascript
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit

function validateFileSize(filePath) {
  const stats = fs.statSync(filePath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE} bytes)`);
  }
}
```

Update `processFile` method:

```javascript
static async processFile(filePath, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // Validate file size
      validateFileSize(filePath);
      
      const ext = path.extname(filePath).toLowerCase();
      console.log(`Processing file: ${filePath}`);
      
      // ... rest of the code
    } catch (error) {
      console.error("Error in processFile:", error);
      reject(error);
    }
  });
}
```

---

### Improvement 2: Secure Temp File Handling

**File:** `renderer.js`

Update the `createTempFile` function to mark files for deletion:

```javascript
const tempFiles = new Set();

function createTempFile(fileItem) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = Buffer.from(reader.result);
      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `pii-anon-${Date.now()}-${fileItem.name}`);
      
      fs.writeFile(tempPath, buffer, (err) => {
        if (err) {
          showStatus(`Error writing temporary file: ${err.message}`, 'error');
          resolve(null);
        } else {
          // Track temp file for cleanup
          tempFiles.add(tempPath);
          resolve({ path: tempPath, name: fileItem.name });
        }
      });
    };
    reader.onerror = () => {
      showStatus(`Error reading file ${fileItem.name}`, 'error');
      resolve(null);
    };
    reader.readAsArrayBuffer(fileItem);
  });
}

// Clean up temp files on exit
window.addEventListener('beforeunload', () => {
  tempFiles.forEach(tempPath => {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (err) {
      console.error(`Failed to delete temp file ${tempPath}:`, err);
    }
  });
});
```

---

### Improvement 3: Add Content Security Policy

**File:** `index.html`

Add CSP meta tag in the `<head>` section:

```html
<head>
  <title>A5 PII Anonymizer</title>
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'none'; 
                 script-src 'self'; 
                 style-src 'self' 'unsafe-inline'; 
                 img-src 'self' data:; 
                 font-src 'self';">
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="all.min.css" />
</head>
```

---

## Testing After Fixes

### 1. Test Basic Functionality
```bash
npm run dev
```

- Test file selection
- Test directory selection
- Test file processing
- Test output directory selection

### 2. Run Security Audit
```bash
npm audit
```

### 3. Test with ESLint Security Plugin
```bash
npm install --save-dev eslint-plugin-security
```

Create `.eslintrc.json`:
```json
{
  "plugins": ["security"],
  "extends": ["plugin:security/recommended"]
}
```

Run linter:
```bash
npx eslint .
```

---

## Verification Checklist

After implementing fixes, verify:

- [ ] No `eval()` or `Function()` constructor usage
- [ ] `nodeIntegration: false` in main.js
- [ ] `contextIsolation: true` in main.js
- [ ] `preload.js` exists and properly exposes APIs
- [ ] All file paths validated before use
- [ ] All directory paths validated before use
- [ ] URL whitelist implemented for shell.openExternal
- [ ] Recursion depth limits added
- [ ] File size limits added
- [ ] Temp file cleanup implemented
- [ ] CSP headers added
- [ ] `npm audit` shows no critical vulnerabilities
- [ ] Application still functions correctly

---

## Additional Resources

- [Electron Security Guidelines](https://www.electronjs.org/docs/latest/tutorial/security)
- [OWASP Electron Security](https://github.com/doyensec/electronegativity)
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [IPC Security](https://www.electronjs.org/docs/latest/tutorial/ipc)

---

## Need Help?

If you need assistance implementing these fixes:

1. Review the Electron security documentation
2. Test each change incrementally
3. Keep backups before making changes
4. Consider hiring a security consultant for production deployments

---

**Document Version:** 1.0  
**Last Updated:** January 2025
