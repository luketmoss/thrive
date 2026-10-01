// #272 AC1 — the page must stay pinch-zoomable (WCAG 1.4.4, 1.4.10).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

describe('index.html viewport meta (#272)', () => {
  it('does not disable zooming', () => {
    const m = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/width=device-width/);
    expect(m![1]).not.toMatch(/user-scalable/i);
    expect(m![1]).not.toMatch(/maximum-scale/i);
  });
});
