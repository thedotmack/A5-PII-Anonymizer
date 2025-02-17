import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';
import pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';

import { pipeline, env } from '@xenova/transformers';
import { fileURLToPath } from 'url';

// ES module paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Transformers.js environment
env.localModelPath = path.join(__dirname, 'models');
env.allowRemoteModels = false;
env.quantized = false;

// Toggle whether we use LLM-based anonymization
const useLLM = true;

// Pipeline reference
let nerPipeline = null;

// Pseudonym counters/mappings
const pseudonymCounters = {};
const pseudonymMapping = {};

/**
 * Returns a consistent pseudonym for a given entity text + type.
 */
function getPseudonym(entityText, entityType) {
  if (pseudonymMapping[entityText]) {
    return pseudonymMapping[entityText];
  }
  if (!pseudonymCounters[entityType]) {
    pseudonymCounters[entityType] = 1;
  }
  const pseudonym = `${entityType}_${pseudonymCounters[entityType]++}`;
  pseudonymMapping[entityText] = pseudonym;
  return pseudonym;
}

/**
 * Aggressively merges consecutive tokens of the same entity type,
 * removing whitespace/punctuation from each token, then concatenating.
 * e.g. “Bay,” + “ona,” + “Wil” + “ber” => “BayonaWilber”
 */
function aggressiveMergeTokens(predictions) {
  if (!predictions || predictions.length === 0) return [];

  const merged = [];
  let current = null;

  for (const pred of predictions) {
    const type = pred.entity.replace(/^(B-|I-)/, '');
    // Remove whitespace/punctuation from each token
    let word = pred.word.replace(/\s+/g, '').replace(/[^\w\s.,'-]/g, '');
    word = word.trim();
    if (!word) continue;

    if (!current) {
      current = { type, text: word };
    } else if (current.type === type) {
      // Same entity => unify
      current.text += word;
    } else {
      // Different entity => push old one, start new
      merged.push(current);
      current = { type, text: word };
    }
  }
  if (current) {
    merged.push(current);
  }
  return merged;
}

/**
 * Safely escapes all regex meta-characters in a string.
 */
function escapeRegexChars(str) {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Builds a fuzzy regex (with 'g' + 'i') that matches the merged string ignoring spacing/punctuation.
 */
function buildFuzzyRegex(mergedString) {
  // Remove punctuation from mergedString
  let noPunc = mergedString.replace(/[^\w]/g, '');
  if (!noPunc) {
    return null;
  }

  // Escape special regex chars
  noPunc = escapeRegexChars(noPunc);

  // Build a pattern that allows any non-alphanumeric between letters
  let pattern = '';
  for (const char of noPunc) {
    pattern += `${char}[^a-zA-Z0-9]*`;
  }
  // No trailing slice, to avoid bracket issues.

  if (!pattern) {
    return null;
  }

  try {
    return new RegExp(pattern, 'ig');
  } catch (err) {
    console.warn(`Regex build failed for pattern="${pattern}". Error: ${err.message}`);
    return null;
  }
}

/**
 * Loads the PII detection model from local files, if not already loaded.
 */
async function loadNERModel() {
  if (!nerPipeline) {
    console.log("Loading PII detection model from local files...");
    nerPipeline = await pipeline('token-classification', 'protectai/lakshyakh93-deberta_finetuned_pii-onnx');
    console.log("Model loaded.");
  }
  return nerPipeline;
}

/**
 * The main anonymization function. 
 * 1) Runs the pipeline
 * 2) Merges partial tokens
 * 3) Uses a fuzzy global regex to replace each merged token with a pseudonym
 */
async function anonymizeText(text) {
  let processedText = String(text);

  const ner = await loadNERModel();
  console.log("Internal LLM processing...");
  const predictions = await ner(processedText);
  console.log("Raw predicted tokens:", predictions);

  const merged = aggressiveMergeTokens(predictions);
  console.log("Aggressively merged tokens:", merged);

  for (const obj of merged) {
    const entityType = obj.type;
    const mergedString = obj.text;
    if (!mergedString) continue;

    const pseudonym = getPseudonym(mergedString, entityType);
    const fuzzyRegex = buildFuzzyRegex(mergedString);
    if (!fuzzyRegex) {
      console.log(`Skipping zero-length or invalid pattern for mergedString="${mergedString}"`);
      continue;
    }

    console.log(`Replacing fuzzy match of "${mergedString}" => regex ${fuzzyRegex} with "${pseudonym}"`);

    // Single-pass global replace
    processedText = processedText.replace(fuzzyRegex, pseudonym);
  }

  console.log("LLM processing complete.");
  return processedText;
}

export class FileProcessor {
  static async processFile(filePath, outputPath) {
    return new Promise(async (resolve, reject) => {
      try {
        const ext = path.extname(filePath).toLowerCase();
        console.log(`Processing file: ${filePath}`);

        if (ext === '.txt' || ext === '.csv') {
          // Text-based approach
          console.log(`Processing text file: ${filePath}`);
          const content = fs.readFileSync(filePath, 'utf8');
          let newContent;
          if (useLLM) {
            console.log("LLM anonymization enabled. Processing text...");
            const anonymizedText = await anonymizeText(content);
            newContent = "Anonymized\n\n" + anonymizedText;
          } else {
            console.log("LLM anonymization disabled. Using default processing.");
            newContent = "Anonymized\n\n" + content;
          }
          fs.writeFileSync(outputPath, newContent, 'utf8');
          console.log(`Text file processed and saved to: ${outputPath}`);
          resolve(true);

        } else if (ext === '.xlsx') {
          // Excel partial coverage
          console.log(`Processing Excel file: ${filePath}`);
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.readFile(filePath);

          for (const worksheet of workbook.worksheets) {
            for (let i = 1; i <= worksheet.rowCount; i++) {
              const row = worksheet.getRow(i);
              for (let j = 1; j <= row.cellCount; j++) {
                const cell = row.getCell(j);
                if (typeof cell.value === 'string') {
                  console.log(`Anonymizing cell [Row ${i}, Col ${j}] with value: ${cell.value}`);
                  cell.value = await anonymizeText(cell.value);
                }
              }
            }
          }

          await workbook.xlsx.writeFile(outputPath);
          console.log(`Excel file processed and saved to: ${outputPath}`);
          resolve(true);

        } else if (ext === '.docx') {
          // DOCX: mammoth + docx approach
          console.log(`Processing DOCX file: ${filePath}`);
          const { value: docxText } = await mammoth.extractRawText({ path: filePath });
          console.log("Extracted DOCX text:", docxText);

          let anonymizedDocxText = docxText;
          if (useLLM) {
            anonymizedDocxText = await anonymizeText(docxText);
          }

          // Create minimal docx with 'docx' library
          const doc = new Document({
            sections: [
              {
                children: [ new Paragraph(anonymizedDocxText) ],
              },
            ],
          });
          const buffer = await Packer.toBuffer(doc);
          fs.writeFileSync(outputPath, buffer);
          console.log(`DOCX file processed and saved to: ${outputPath}`);
          resolve(true);

        } else if (ext === '.pdf') {
          // PDF: pdf-parse + pdf-lib approach
          console.log(`Processing PDF file: ${filePath}`);
          const dataBuffer = fs.readFileSync(filePath);
          const data = await pdfParse(dataBuffer);
          const pdfText = data.text;
          console.log("Extracted PDF text:", pdfText);

          let anonymizedPdfText = pdfText;
          if (useLLM) {
            anonymizedPdfText = await anonymizeText(pdfText);
          }

          // Create a minimal PDF with pdf-lib
          const doc = await PDFDocument.create();
          const page = doc.addPage();
          page.drawText(anonymizedPdfText, { x: 50, y: 700, size: 12 });
          const pdfBytes = await doc.save();
          fs.writeFileSync(outputPath, pdfBytes);
          console.log(`PDF file processed and saved to: ${outputPath}`);
          resolve(true);

        } else {
          // For other file types, just copy
          console.log(`Processing binary file: ${filePath}`);
          fs.copyFileSync(filePath, outputPath);
          console.log(`Binary file copied to: ${outputPath}`);
          resolve(true);
        }
      } catch (error) {
        console.error("Error in processFile:", error);
        reject(error);
      }
    });
  }

  static generateOutputFileName(originalName) {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);
    return `${baseName}-anon${ext}`;
  }

  static validateFileType(filePath) {
    const supportedTypes = [
      '.doc', '.docx', '.xls', '.xlsx', '.csv', '.pdf', '.txt'
    ];
    const ext = path.extname(filePath).toLowerCase();
    return supportedTypes.includes(ext);
  }
}
