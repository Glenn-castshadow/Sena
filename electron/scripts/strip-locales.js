'use strict';
const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'dist', 'Sena Job Tracker-win32-x64', 'locales');
const keep = new Set(['en-US.pak']);

if (!fs.existsSync(localesDir)) {
  console.log('Locales dir not found — skipping cleanup.');
  process.exit(0);
}

let removed = 0;
for (const file of fs.readdirSync(localesDir)) {
  if (!keep.has(file)) {
    fs.unlinkSync(path.join(localesDir, file));
    removed++;
  }
}
console.log(`Locale cleanup: removed ${removed} files, kept en-US.pak.`);
