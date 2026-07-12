const ejs = require('ejs');
const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '../views');

function compileFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    ejs.compile(content, { filename: filePath });
    console.log(`Successfully compiled: ${path.relative(viewsDir, filePath)}`);
  } catch (err) {
    console.error(`FAILED to compile: ${path.relative(viewsDir, filePath)}`);
    console.error(err.message);
    console.error(err.stack);
  }
}

function traverse(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      traverse(fullPath);
    } else if (file.endsWith('.ejs')) {
      compileFile(fullPath);
    }
  }
}

traverse(viewsDir);
