# A5 PII Anonymizer

This repository provides an **Electron** desktop application for **locally anonymizing documents** before sending them to advanced Large Language Models (LLMs). By stripping out personal or identifiable information using a **context-aware** model, you can safely train or query external LLMs (e.g., OpenAI’s o3 model) with minimal privacy risk.

## Motivation

- **PII Removal**: Traditional RegEx-based anonymization often fails on nuanced data. With an ONNX-based model, you gain context-aware detection for **names, addresses, phone numbers, etc.**
- **Safe LLM Usage**: Many companies need to keep real customer or employee data **internal** but still want to leverage powerful external LLMs. This tool helps them do so by anonymizing data **on their end** first.
- **Flexible**: Supports `.txt`, `.docx`, `.xls(x)`, `.csv`, `.pdf`, and more. Converts text, merges tokens, and replaces them with consistent pseudonyms.

## Key Features

1. **Electron App**: Cross-platform desktop UI built on HTML/CSS/JS.  
2. **Daily Limit**: **100** documents per day for the free tier (by default). You can raise or remove it if you prefer—this is open source.  
3. **Context-Aware**: Relies on a local ONNX model downloaded separately (due to GitHub’s file-size constraints).  
4. **Mapping** (Pro Mode): If you enable Pro, the app can produce a JSON file mapping each original entity (e.g., “John Smith”) to its anonymized token (e.g., “NAME_1”).  
5. **MIT License**: Free to modify and distribute. We welcome contributions.

## Getting Started

1. **Clone or Download** this repository.  
    - Model available here: [https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information/tree/main](https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information/tree/main)
   - Download the ONNX model (`.onnx` files) from our external link (not included here due to size constraints).  
   - Place it under `./models/protectai/lakshyakh93-deberta_finetuned_pii-onnx/` or as directed in `fileProcessor.js`.  
3. **Install Dependencies**:  
   ```bash
   npm install
   ```  
4. **Run (Dev Mode)**:  
   ```bash
   npm run dev
   ```  
   Or if you prefer:  
   ```bash
   npx electron .
   ```  
5. **Build / Package** (macOS example):  
   ```bash
   npm run build:mac


### Basic Usage

- **Drop or Select Files**: The main UI allows you to drag-and-drop or pick multiple files/folders.  
- **Output Directory**: Choose where the anonymized files should be placed.  
- **Anonymize**: Click “Anonymize Files” to run.  
- **Mapping (Pro)**: If you have a Pro key, the app will create an additional `-map.json` file capturing each replaced entity.  

## How It Works

- **Electron**:  
  - **`main.js`**: Spawns the main window, handles file selection, passes tasks to `FileProcessor`.  
  - **`renderer.js`**: Manages the UI (index.html), user interactions, daily usage counters, and “Pro” logic.  
- **`fileProcessor.js`**:  
  - Loads the local ONNX model (via `@xenova/transformers`).  
  - Identifies personal data by context (names, addresses, etc.).  
  - Replaces them with tokens (`NAME_1`, `PHONE_NUMBER_3`, etc.).  
  - If Pro, writes a JSON mapping for re-identification.  
- **Local Model**:  
  - We rely on a context-aware token classification model. This is significantly more effective than simple RegEx for real-world PII.

## Limitations & Notes

- **Daily 100-File Limit**: By default, the free version only processes 100 documents per day. This is purely enforced in the UI. Since it’s open source, you can remove or change it as needed.  
- **No Guarantee**: Even context-aware models can miss certain edge cases. Always manually review if 100% privacy is critical.  
- **Cross-Platform**:  
  - macOS builds are tested on both M-series (ARM) and Intel.  
  - Windows and Linux builds are also available.

## Contributing

We use the **MIT License**, so feel free to open pull requests, modify the code, or adapt it for your needs. If you make improvements or fix bugs, please share them back!

---

**Thanks for checking out the A5 PII Anonymizer.** We hope this helps you safely leverage powerful LLMs with real data while keeping personal information private.