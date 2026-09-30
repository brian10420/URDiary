import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'assets/vendor/fontawesome/fontawesome-subset.css'), 'utf8');

// Every "fa-<name>" icon class referenced by the app's markup and scripts.
// (Modifier-free: the app only uses the bare "fa fa-<name>" pair.)
function referencedIcons() {
    const files = ['index.html']
        .concat(fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f));
    const found = new Set();
    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of src.matchAll(/\bfa fa-([a-z0-9-]+)/g)) found.add(m[1]);
    }
    return [...found].sort();
}

describe('Font Awesome subset', () => {
    it('finds icons to check (guards against a vacuous grep)', () => {
        expect(referencedIcons().length).toBeGreaterThanOrEqual(12);
    });

    it('has a ::before rule for every fa-<name> used by index.html and js/*.js', () => {
        const defined = new Set([...CSS.matchAll(/\.fa-([a-z0-9-]+)::?before\s*\{\s*content:\s*"\\([0-9a-f]+)"/gi)].map(m => m[1]));
        const missing = referencedIcons().filter(n => !defined.has(n));
        expect(missing).toEqual([]);
    });
});
