const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '../views');

function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      getFiles(name, fileList);
    } else if (file.endsWith('.ejs') && !name.includes('admin') && !name.includes('admin-login')) {
      fileList.push(name);
    }
  }
  return fileList;
}

const ejsFiles = getFiles(VIEWS_DIR);
console.log(`Analyzing ${ejsFiles.length} EJS files...`);

const htmlTagRegex = /<[^>]+>/g;
const ejsTagRegex = /<%[\s\S]*?%>/g;

ejsFiles.forEach(filePath => {
  const relative = path.relative(path.join(__dirname, '..'), filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const untranslated = [];

  lines.forEach((line, idx) => {
    // 1. Remove all EJS tags so we don't look inside them
    let cleanLine = line.replace(ejsTagRegex, ' ');
    
    // 2. Extract contents between > and <
    const matches = cleanLine.match(/>([^<]+)</g);
    if (matches) {
      matches.forEach(m => {
        const text = m.substring(1, m.length - 1).trim();
        // Check if it contains letters (i.e. user-facing text)
        if (text && /[a-zA-ZÀ-ÿ]/.test(text) && !/^[a-zA-Z0-9_\.-]+$/.test(text)) {
          untranslated.push({ line: idx + 1, type: 'text', text });
        }
      });
    }

    // 3. Extract common attributes
    const attrRegex = /\b(placeholder|title|aria-label|alt|value)\s*=\s*"([^"<%]+)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(cleanLine)) !== null) {
      const text = attrMatch[2].trim();
      if (text && /[a-zA-ZÀ-ÿ]/.test(text) && !/^[a-zA-Z0-9_\.-]+$/.test(text)) {
        untranslated.push({ line: idx + 1, type: 'attribute ' + attrMatch[1], text });
      }
    }
  });

  if (untranslated.length > 0) {
    console.log(`\n--- ${relative} (${untranslated.length} findings) ---`);
    untranslated.forEach(item => {
      console.log(`  Line ${item.line} [${item.type}]: "${item.text}"`);
    });
  }
});
