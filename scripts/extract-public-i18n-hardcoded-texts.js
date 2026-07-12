const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_JSON = path.join(ROOT_DIR, 'scratch', 'public-hardcoded-texts-report.json');
const OUTPUT_MD = path.join(ROOT_DIR, 'scratch', 'public-hardcoded-texts-report.md');

const TARGETS = [
  { baseDir: 'views', exts: new Set(['.ejs']), type: 'ejs' },
  { baseDir: path.join('public', 'js'), exts: new Set(['.js']), type: 'js' },
  { baseDir: 'controllers', exts: new Set(['.js']), type: 'js' },
  { baseDir: 'routes', exts: new Set(['.js']), type: 'js' },
  { baseDir: 'models', exts: new Set(['.js']), type: 'js' },
  { baseDir: 'utils', exts: new Set(['.js']), type: 'js' },
  { baseDir: '.', exts: new Set(['.js']), type: 'js', fileFilter: (relativePath) => relativePath === 'server.js' }
];

const IGNORE_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'scratch'
]);

const IGNORE_FILES = new Set([
  'views/admin.ejs',
  'views/admin-login.ejs',
  'controllers/adminController.js',
  'controllers/adminAuthController.js',
  'utils/i18n.js'
]);

function walk(dirPath, matcher, found = []) {
  if (!fs.existsSync(dirPath)) return found;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, '/');

    if ([...IGNORE_PATH_SEGMENTS].some((segment) => relativePath.split('/').includes(segment))) {
      continue;
    }

    if (IGNORE_FILES.has(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(absolutePath, matcher, found);
      continue;
    }

    if (matcher(relativePath, absolutePath)) {
      found.push({ relativePath, absolutePath });
    }
  }

  return found;
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBasicEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isLikelyUserFacing(text) {
  const normalized = normalizeWhitespace(decodeBasicEntities(text));
  if (!normalized) return false;
  if (normalized.length < 2) return false;
  if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return false;
  if ((normalized.match(/:/g) || []).length > 2 && (normalized.match(/;/g) || []).length > 1) return false;
  if (/^(<|\.|#|\[|@media\b)/.test(normalized)) return false;
  if (/\b(data-|aria-|class=|style=|href=|src=)\b/i.test(normalized)) return false;
  if (/^(true|false|null|undefined)$/i.test(normalized)) return false;
  if (/^(get|post|put|patch|delete|select|insert|update|from|where|join|order by|limit)\b/i.test(normalized)) return false;
  if (/^(linear-gradient|rgba?\(|#[0-9a-f]{3,8}|var\(|calc\(|translate|scale|rotate)/i.test(normalized)) return false;
  if (/^(\/|\.\/|\.\.\/|https?:\/\/|wss?:\/\/)/i.test(normalized)) return false;
  if (/^[A-Za-z0-9_.-]+$/.test(normalized) && !/\s/.test(normalized)) return false;
  if (/^(width|height|display|position|padding|margin|border|background|color|cursor|transition|overflow|font-size|font-weight)$/i.test(normalized)) return false;
  if (/^[A-Z0-9_ -]+$/.test(normalized) && !/\s/.test(normalized)) return false;
  return true;
}

function collectEjsTexts(fileContent) {
  const findings = [];
  const lines = fileContent.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("t('") || line.includes('t("')) continue;

    const withoutEjs = line.replace(/<%[\s\S]*?%>/g, ' ');
    const textMatches = withoutEjs.match(/>([^<]+)</g) || [];
    for (const match of textMatches) {
      const rawText = match.slice(1, -1);
      const normalized = normalizeWhitespace(decodeBasicEntities(rawText));
      if (isLikelyUserFacing(normalized)) {
        findings.push({ line: index + 1, kind: 'text-node', text: normalized });
      }
    }

    const attrRegex = /\b(?:placeholder|title|aria-label|alt|value)\s*=\s*"([^"]+)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(withoutEjs)) !== null) {
      const normalized = normalizeWhitespace(decodeBasicEntities(attrMatch[1]));
      if (isLikelyUserFacing(normalized)) {
        findings.push({ line: index + 1, kind: 'attribute', text: normalized });
      }
    }
  }

  return findings;
}

function collectJsTexts(fileContent) {
  const findings = [];
  const lines = fileContent.split('\n');
  const stringRegex = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes('t(') || line.includes('createTranslator(')) continue;

    let match;
    while ((match = stringRegex.exec(line)) !== null) {
      let rawText = match[2].replace(/\$\{[^}]+\}/g, ' ');
      if (rawText.includes('<')) {
        rawText = rawText.replace(/<[^>]+>/g, ' ');
      }
      const normalized = normalizeWhitespace(decodeBasicEntities(rawText));
      if (!isLikelyUserFacing(normalized)) continue;
      findings.push({ line: index + 1, kind: 'string-literal', text: normalized });
    }
  }

  return findings;
}

function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.line}:${item.kind}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildReport() {
  const files = [];

  for (const target of TARGETS) {
    const baseAbsolute = path.join(ROOT_DIR, target.baseDir);
    const matched = walk(baseAbsolute, (relativePath, absolutePath) => {
      if (target.fileFilter) return target.fileFilter(relativePath, absolutePath);
      return target.exts.has(path.extname(relativePath));
    });

    for (const file of matched) {
      const content = fs.readFileSync(file.absolutePath, 'utf8');
      const findings = target.type === 'ejs'
        ? collectEjsTexts(content)
        : collectJsTexts(content);

      const deduped = uniqueFindings(findings);
      if (deduped.length === 0) continue;

      files.push({
        file: file.relativePath,
        count: deduped.length,
        findings: deduped
      });
    }
  }

  files.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.file.localeCompare(b.file);
  });

  const totalCount = files.reduce((sum, file) => sum + file.count, 0);

  return {
    generatedAt: new Date().toISOString(),
    scope: 'Public platform only (admin views/controllers excluded)',
    totalFiles: files.length,
    totalCount,
    files
  };
}

function writeMarkdown(report) {
  const lines = [
    '# Public Hardcoded Texts Report',
    '',
    `Generated at: ${report.generatedAt}`,
    `Scope: ${report.scope}`,
    `Files with findings: ${report.totalFiles}`,
    `Total findings: ${report.totalCount}`,
    '',
    '## Files',
    ''
  ];

  for (const file of report.files) {
    lines.push(`### ${file.file} (${file.count})`);
    lines.push('');
    for (const finding of file.findings) {
      lines.push(`- L${finding.line} [${finding.kind}] ${finding.text}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function ensureOutputDir() {
  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
}

function main() {
  ensureOutputDir();
  const report = buildReport();
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUTPUT_MD, writeMarkdown(report));
  console.log(`Report generated: ${path.relative(ROOT_DIR, OUTPUT_JSON)}`);
  console.log(`Markdown summary: ${path.relative(ROOT_DIR, OUTPUT_MD)}`);
  console.log(`Files with findings: ${report.totalFiles}`);
  console.log(`Total findings: ${report.totalCount}`);
}

main();
