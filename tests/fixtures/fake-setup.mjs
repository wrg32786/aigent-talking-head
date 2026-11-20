// Stands in for kit/setup.mjs in tests/studio-session.test.mjs (STUDIO_SETUP): prints its arguments; when FAKE_SETUP_WROTE
// names a file, writes it, prints the "wrote <file> len" line a finished render prints, then waits, so a cancel lands late.
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
console.log('fake setup ' + process.argv.slice(2).join(' '));
const f = process.env.FAKE_SETUP_WROTE;
if (f) { mkdirSync(dirname(resolve(f)), { recursive: true }); writeFileSync(resolve(f), 'x'); console.log(`wrote ${f} len 1.00`); setTimeout(() => {}, 8000); }
