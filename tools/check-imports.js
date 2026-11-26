import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

let totalFilesChecked = 0;
let totalImportsChecked = 0;
let errors = 0;

function checkFileImports(filePath) {
  totalFilesChecked++;
  const content = fs.readFileSync(filePath, 'utf8');
  // Match import statements: import ... from '...' or import '...'
  const importRegex = /import\s+(?:(?:(?:\*\s+as\s+\w+|[\w$]+(?:,\s*\{[^}]*\})?|\{[^}]*\})\s+from\s+)?['"]([^'"]+)['"])/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const importPathRaw = match[1];
    // Strip query string (e.g., ?v=1.8.125)
    const importPath = importPathRaw.split('?')[0];
    totalImportsChecked++;

    if (importPath.startsWith('https://') || importPath.startsWith('http://')) {
      // Remote URL, skip disk check
      continue;
    }

    let resolvedPath = '';
    if (importPath.startsWith('/')) {
      resolvedPath = path.join(publicDir, importPath.slice(1));
    } else {
      resolvedPath = path.resolve(path.dirname(filePath), importPath);
    }

    if (!fs.existsSync(resolvedPath)) {
      console.error(`[check-imports] Broken import in ${path.relative(rootDir, filePath)}:`);
      console.error(`   '${importPathRaw}' -> file not found at ${path.relative(rootDir, resolvedPath)}`);
      errors++;
    }
  }
}

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'vendor') {
        scanDir(fullPath);
      }
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.html')) {
      checkFileImports(fullPath);
    }
  }
}

scanDir(publicDir);

console.log(`[check-imports] Checked ${totalFilesChecked} files and ${totalImportsChecked} imports.`);
if (errors > 0) {
  console.error(`[check-imports] FAILED with ${errors} broken imports.`);
  process.exit(1);
} else {
  console.log(`[check-imports] PASSED with 0 errors.`);
}
