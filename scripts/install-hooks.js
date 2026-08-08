'use strict';
const fs   = require('node:fs');
const path = require('node:path');

const src  = path.join(__dirname, 'hooks', 'pre-commit');
const dest = path.join(__dirname, '..', '.git', 'hooks', 'pre-commit');

if (!fs.existsSync(path.join(__dirname, '..', '.git'))) {process.exit(0);}

fs.copyFileSync(src, dest);
fs.chmodSync(dest, 0o755);
console.log('git hook installed: pre-commit (blocks direct commits to master)');
