import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.agentuity',
  'dist',
  'build',
  '.next',
]);

export async function buildFileIndex(
  root: string,
  limit: number = 600
): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string) {
    if (files.length >= limit) return;

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name.startsWith('.')) continue;

      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(relative(root, fullPath));
      }
    }
  }

  await walk(root);
  return files.slice(0, limit);
}
