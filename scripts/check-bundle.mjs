import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const assetsDirectory = path.resolve('dist', 'assets');
const entryBudgetBytes = 100 * 1024;
const files = await readdir(assetsDirectory);
const entryFiles = files.filter((file) => /^main-[\w-]+\.js$/.test(file));

if (entryFiles.length !== 1) {
  throw new Error(
    `Expected one built main entry in ${assetsDirectory}; found ${entryFiles.length}.`,
  );
}

const entryFile = entryFiles[0];
const { size } = await stat(path.join(assetsDirectory, entryFile));
const sizeKiB = (size / 1024).toFixed(1);
const budgetKiB = entryBudgetBytes / 1024;

if (size > entryBudgetBytes) {
  throw new Error(
    `${entryFile} is ${sizeKiB} KiB, above the ${budgetKiB} KiB initial-entry budget.`,
  );
}

console.log(`Bundle budget passed: ${entryFile} is ${sizeKiB} KiB (limit ${budgetKiB} KiB).`);
