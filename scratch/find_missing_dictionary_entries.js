const fs = require('fs');
const path = require('path');

const i18nModule = require('../utils/i18n');
const SOURCE_TEXT_TRANSLATIONS = i18nModule.SOURCE_TEXT_TRANSLATIONS;
const TRANSLATIONS = i18nModule.TRANSLATIONS;

// Find all translation keys in i18n.js
const sourceTextKeysEn = new Set(Object.keys(SOURCE_TEXT_TRANSLATIONS.en || {}));
const sourceTextKeysEs = new Set(Object.keys(SOURCE_TEXT_TRANSLATIONS.es || {}));

const keyTranslationsEn = new Set();
const keyTranslationsEs = new Set();

function extractKeyPaths(obj, currentPath = '') {
  const paths = [];
  for (const [key, value] of Object.entries(obj)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    if (typeof value === 'string') {
      paths.push(nextPath);
    } else if (typeof value === 'object' && value !== null) {
      paths.push(...extractKeyPaths(value, nextPath));
    }
  }
  return paths;
}

extractKeyPaths(TRANSLATIONS.en || {}).forEach(k => keyTranslationsEn.add(k));
extractKeyPaths(TRANSLATIONS.es || {}).forEach(k => keyTranslationsEs.add(k));

console.log(`Loaded i18n:`);
console.log(`- SOURCE_TEXT_TRANSLATIONS: ${sourceTextKeysEn.size} in en, ${sourceTextKeysEs.size} in es`);
console.log(`- Key-based TRANSLATIONS: ${keyTranslationsEn.size} in en, ${keyTranslationsEs.size} in es`);

const EJS_DIR = path.join(__dirname, '../views');
const CLIENT_JS = path.join(__dirname, '../public/js/client.js');
const CONTROLLERS_DIR = path.join(__dirname, '../controllers');

function getFiles(dir, ext, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      getFiles(name, ext, fileList);
    } else if (file.endsWith(ext) && !name.includes('admin') && !name.includes('admin-login')) {
      fileList.push(name);
    }
  }
  return fileList;
}

const filesToScan = [
  ...getFiles(EJS_DIR, '.ejs'),
  ...getFiles(CONTROLLERS_DIR, '.js'),
  CLIENT_JS
];

console.log(`\nScanning ${filesToScan.length} files...`);

// Regex to find tText("...") or tText('...') or tText(`...`)
const tTextRegex = /\b(?:tText|__text)\s*\(\s*(['"`])([\s\S]*?)\1\s*[\),]/g;

// Regex to find t('...') or t("...") or translate('...') or translate("...")
const keyRegex = /\b(?:t|translate)\s*\(\s*(['"`])([\s\S]*?)\1\s*[\),]/g;

const missingSourceEn = {};
const missingSourceEs = {};
const missingKeyEn = {};
const missingKeyEs = {};

filesToScan.forEach(filePath => {
  const relative = path.relative(path.join(__dirname, '..'), filePath);
  const content = fs.readFileSync(filePath, 'utf8');

  let match;
  // Reset regexes
  tTextRegex.lastIndex = 0;
  keyRegex.lastIndex = 0;

  while ((match = tTextRegex.exec(content)) !== null) {
    let text = match[2].trim();
    const quote = match[1];
    if (quote === "'") {
      text = text.replace(/\\'/g, "'");
    } else if (quote === '"') {
      text = text.replace(/\\"/g, '"');
    }
    // Exclude placeholders or code-like items
    if (text && /[a-zA-ZÀ-ÿ]/.test(text) && !/^[a-zA-Z0-9_\.-]+$/.test(text)) {
      if (!sourceTextKeysEn.has(text)) {
        if (!missingSourceEn[text]) missingSourceEn[text] = [];
        missingSourceEn[text].push(relative);
      }
      if (!sourceTextKeysEs.has(text)) {
        if (!missingSourceEs[text]) missingSourceEs[text] = [];
        missingSourceEs[text].push(relative);
      }
    }
  }

  while ((match = keyRegex.exec(content)) !== null) {
    const key = match[2].trim();
    if (key && /^[a-zA-Z0-9_\.]+$/.test(key)) {
      if (!keyTranslationsEn.has(key)) {
        if (!missingKeyEn[key]) missingKeyEn[key] = [];
        missingKeyEn[key].push(relative);
      }
      if (!keyTranslationsEs.has(key)) {
        if (!missingKeyEs[key]) missingKeyEs[key] = [];
        missingKeyEs[key].push(relative);
      }
    }
  }
});

console.log(`\n=== MISSING SOURCE TEXT DICTIONARY ENTRIES (ENGLISH) ===`);
Object.entries(missingSourceEn).forEach(([text, files]) => {
  console.log(`"${text}" -> files: ${files.join(', ')}`);
});

console.log(`\n=== MISSING SOURCE TEXT DICTIONARY ENTRIES (SPANISH) ===`);
Object.entries(missingSourceEs).forEach(([text, files]) => {
  console.log(`"${text}" -> files: ${files.join(', ')}`);
});

console.log(`\n=== MISSING KEY-BASED DICTIONARY ENTRIES (ENGLISH) ===`);
Object.entries(missingKeyEn).forEach(([key, files]) => {
  console.log(`"${key}" -> files: ${files.join(', ')}`);
});

console.log(`\n=== MISSING KEY-BASED DICTIONARY ENTRIES (SPANISH) ===`);
Object.entries(missingKeyEs).forEach(([key, files]) => {
  console.log(`"${key}" -> files: ${files.join(', ')}`);
});
