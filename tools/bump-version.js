#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const appJsPath = path.resolve(__dirname, '../public/js/core/app.js');
const publicDir = path.resolve(__dirname, '../public');

if (!fs.existsSync(appJsPath)) {
  console.error('Error: Could not find public/js/core/app.js at', appJsPath);
  process.exit(1);
}

// 1. Read current version from app.js
const appJsContent = fs.readFileSync(appJsPath, 'utf8');
const versionMatch = appJsContent.match(/export\s+const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/);

if (!versionMatch) {
  console.error('Error: Could not find APP_VERSION definition in', appJsPath);
  process.exit(1);
}

const currentVersion = versionMatch[1];

// 2. Determine target version
let targetVersion = process.argv[2];
if (!targetVersion) {
  const parts = currentVersion.split('.');
  const lastIndex = parts.length - 1;
  const lastNum = parseInt(parts[lastIndex], 10);
  if (isNaN(lastNum)) {
    console.error('Error: Last component of version is not a number:', currentVersion);
    process.exit(1);
  }
  parts[lastIndex] = String(lastNum + 1);
  targetVersion = parts.join('.');
}

console.log(`Bumping version: ${currentVersion} -> ${targetVersion}\n`);

// 3. Find all .html and .js files recursively in public/
function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (item.endsWith('.html') || item.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = getFiles(publicDir);

let totalReplacements = 0;
let modifiedFilesCount = 0;

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf8');
  let fileReplacements = 0;

  // Replace all ?v=<version>
  const newContent = content.replace(/\?v=[0-9.]+/g, (match) => {
    fileReplacements++;
    return `?v=${targetVersion}`;
  });

  let fileChanged = false;

  if (fileReplacements > 0) {
    totalReplacements += fileReplacements;
    content = newContent;
    fileChanged = true;
  }

  // If this is app.js, also update APP_VERSION
  if (filePath === appJsPath) {
    const updatedAppJs = content.replace(
      /export\s+const\s+APP_VERSION\s*=\s*['"][^'"]+['"]/,
      `export const APP_VERSION = '${targetVersion}'`
    );
    if (updatedAppJs !== content) {
      content = updatedAppJs;
      fileChanged = true;
    }
  }

  // If this is index.html, also update window.__BUILD__
  if (filePath.endsWith('index.html')) {
    const updatedIndex = content.replace(
      /window\.__BUILD__\s*=\s*['"][^'"]+['"]/,
      `window.__BUILD__ = '${targetVersion}'`
    );
    if (updatedIndex !== content) {
      content = updatedIndex;
      fileChanged = true;
    }
  }

  if (fileChanged) {
    fs.writeFileSync(filePath, content, 'utf8');
    modifiedFilesCount++;
    const relPath = path.relative(path.resolve(__dirname, '..'), filePath).replace(/\\/g, '/');
    console.log(`[updated] ${relPath} (${fileReplacements} ?v= occurrences replaced)`);
  }
}

console.log(`\nCompleted!`);
console.log(`Total ?v= replacements: ${totalReplacements}`);
console.log(`Modified files: ${modifiedFilesCount}`);
console.log(`New APP_VERSION: ${targetVersion}`);
