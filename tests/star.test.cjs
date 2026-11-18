#!/usr/bin/env node
// Tests for the post-render star reminder (kit/star.cjs). Run: node tests/star.test.cjs
const { selfTest } = require('../kit/star.cjs');
const errs = selfTest();
if (errs.length) {
  errs.forEach(e => console.error('  error: ' + e));
  console.error(`${errs.length} error(s).`);
  process.exit(1);
}
console.log('STAR PASS');
