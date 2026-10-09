// #366 — the migration scripts these tests import start with a `#!` line, and
// vitest cannot load one that ends in `\r`. `.gitattributes` pins them to LF.
// Asserted through git itself, so removing or narrowing the rule fails CI on
// Linux, not only on a Windows checkout where the symptom shows.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

describe('AC3: shebang scripts check out LF', () => {
  it('resolves every tracked scripts/*.mjs to eol: lf', () => {
    const files = git('ls-files', 'scripts/*.mjs').split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);

    const eol = git('check-attr', 'eol', '--', ...files).trim().split('\n');
    expect(eol).toEqual(files.map((f) => `${f}: eol: lf`));
  });
});
