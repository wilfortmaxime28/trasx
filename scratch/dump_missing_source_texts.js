const fs = require('fs');
const path = require('path');

const i18nModule = require('../utils/i18n');
const SOURCE_TEXT_TRANSLATIONS = i18nModule.SOURCE_TEXT_TRANSLATIONS;

// Find all translation keys in i18n.js
const sourceTextKeysEn = new Set(Object.keys(SOURCE_TEXT_TRANSLATIONS.en || {}));
const sourceTextKeysEs = new Set(Object.keys(SOURCE_TEXT_TRANSLATIONS.es || {}));

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

// Regex to find tText("...") or tText('...') or tText(`...`)
const tTextRegex = /\b(?:tText|__text)\s*\(\s*(['"`])([\s\S]*?)\1\s*[\),]/g;

const missingSourceEn = new Set();
const missingSourceEs = new Set();

filesToScan.forEach(filePath => {
  const content = fs.readFileSync(filePath, 'utf8');

  let match;
  tTextRegex.lastIndex = 0;

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
        missingSourceEn.add(text);
      }
      if (!sourceTextKeysEs.has(text)) {
        missingSourceEs.add(text);
      }
    }
  }
});

const missingListEn = Array.from(missingSourceEn);
const missingListEs = Array.from(missingSourceEs);

fs.writeFileSync(
  path.join(__dirname, 'missing_source_texts.json'),
  JSON.stringify({ en: missingListEn, es: missingListEs }, null, 2),
  'utf8'
);

console.log(`Successfully dumped ${missingListEn.length} missing source texts for EN and ${missingListEs.length} for ES.`);
