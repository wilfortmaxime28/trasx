const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VIEWS_DIR = path.join(ROOT_DIR, 'views');

const EXCLUDED = new Set([
  'views/admin.ejs',
  'views/admin-login.ejs'
]);

function listFiles(dirPath, found = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, '/');
    if (EXCLUDED.has(relativePath)) continue;
    if (entry.isDirectory()) {
      listFiles(absolutePath, found);
      continue;
    }
    if (path.extname(entry.name) === '.ejs') {
      found.push({ absolutePath, relativePath });
    }
  }
  return found;
}

function decodeLiteral(rawLiteral) {
  try {
    return Function(`return "${rawLiteral}";`)();
  } catch (error) {
    return rawLiteral
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
}

function isUnsafeTranslatedFragment(text) {
  const normalized = String(text || '');
  return (
    normalized.includes('<%=') ||
    normalized.includes('${') ||
    normalized.includes('data-') ||
    normalized.includes('style=') ||
    normalized.includes('src=') ||
    normalized.includes('href=') ||
    normalized.includes('alt=') ||
    normalized.includes('title=') ||
    normalized.includes('aria-') ||
    normalized.includes('onclick') ||
    normalized.includes('replace(') ||
    normalized.includes('=>') ||
    normalized.includes('||') ||
    normalized.includes('&&') ||
    normalized.includes('width:') ||
    normalized.includes('height:') ||
    normalized.includes('display:') ||
    normalized.includes('background:') ||
    normalized.includes('font-size:') ||
    normalized.includes('cursor:') ||
    normalized.includes('class=') ||
    normalized.includes('id=') ||
    normalized.includes('/assets/') ||
    normalized.includes('</') ||
    normalized.includes('/>') ||
    normalized.includes('">') ||
    normalized.includes('="') ||
    normalized.includes('" ') ||
    normalized.includes(' ?"') ||
    normalized.includes(' :"') ||
    /[<>]/.test(normalized)
  );
}

function cleanupContent(content) {
  return content.replace(/<%=\s*tText\("((?:\\.|[^"])*)"\)\s*%>/g, (match, rawLiteral) => {
    const decoded = decodeLiteral(rawLiteral);
    if (!isUnsafeTranslatedFragment(decoded)) return match;
    return decoded;
  });
}

function main() {
  const files = listFiles(VIEWS_DIR);
  let changed = 0;

  for (const file of files) {
    const original = fs.readFileSync(file.absolutePath, 'utf8');
    const cleaned = cleanupContent(original);
    if (cleaned !== original) {
      fs.writeFileSync(file.absolutePath, cleaned);
      changed += 1;
      console.log(`Cleaned: ${file.relativePath}`);
    }
  }

  console.log(`Done. Cleaned files: ${changed}`);
}

main();
