const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, '../views/index.ejs'), 'utf8');

const regex = /<%-?([\s\S]*?)%>/g;
let match;
let count = 0;
while ((match = regex.exec(content)) !== null) {
  count++;
  const code = match[1].trim();
  console.log(`[Scriptlet ${count}] (Line around ${content.substring(0, match.index).split('\n').length}):`);
  console.log(code);
  console.log('-----------------------------------');
}
