const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VIEWS_DIR = path.join(ROOT_DIR, 'views');

const EXCLUDED = new Set([
  'views/admin.ejs',
  'views/admin-login.ejs'
]);

function isLikelyUserFacing(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return false;
  if (normalized.length < 2) return false;
  if (/^(https?:\/\/|\/|#|\.|@media\b)/i.test(normalized)) return false;
  if (/^(true|false|null|undefined)$/i.test(normalized)) return false;
  if (/^(linear-gradient|rgba?\(|var\(|calc\(|translate|scale|rotate)/i.test(normalized)) return false;
  if (/^[A-Za-z0-9_.-]+$/.test(normalized) && !/\s/.test(normalized)) return false;
  return true;
}

function listViewFiles(dirPath, found = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, '/');

    if (EXCLUDED.has(relativePath)) continue;

    if (entry.isDirectory()) {
      listViewFiles(absolutePath, found);
      continue;
    }

    if (path.extname(entry.name) === '.ejs') {
      found.push({ absolutePath, relativePath });
    }
  }

  return found;
}

function wrapTextNode(rawText) {
  const leading = rawText.match(/^\s*/)?.[0] || '';
  const trailing = rawText.match(/\s*$/)?.[0] || '';
  const trimmed = rawText.trim();
  if (!isLikelyUserFacing(trimmed)) return rawText;
  return `${leading}<%= tText(${JSON.stringify(trimmed)}) %>${trailing}`;
}

function transformLine(line) {
  let nextLine = line;

  nextLine = nextLine.replace(
    /\b(placeholder|title|aria-label|alt|value)\s*=\s*"([^"<%]+)"/g,
    (match, attrName, attrValue) => {
      const trimmed = attrValue.trim();
      if (!isLikelyUserFacing(trimmed)) return match;
      return `${attrName}="<%= tText(${JSON.stringify(trimmed)}) %>"`;
    }
  );

  nextLine = nextLine.replace(/>([^<]+)</g, (match, textContent) => {
    if (textContent.includes('<%')) return match;
    return `>${wrapTextNode(textContent)}<`;
  });

  return nextLine;
}

function migrateFile(absolutePath) {
  const original = fs.readFileSync(absolutePath, 'utf8');
  const lines = original.split('\n');
  let inScript = false;
  const migrated = lines.map((line) => {
    if (line.includes('<script')) {
      inScript = true;
    }

    let nextLine = line;
    if (!inScript && !line.includes('tText(')) {
      nextLine = transformLine(line);
    }

    if (line.includes('</script>')) {
      inScript = false;
    }

    return nextLine;
  }).join('\n');

  if (migrated !== original) {
    fs.writeFileSync(absolutePath, migrated);
    return true;
  }

  return false;
}

function main() {
  const files = listViewFiles(VIEWS_DIR);
  let changed = 0;

  for (const file of files) {
    if (migrateFile(file.absolutePath)) {
      changed += 1;
      console.log(`Migrated: ${file.relativePath}`);
    }
  }

  console.log(`Done. Changed files: ${changed}`);
}

main();
