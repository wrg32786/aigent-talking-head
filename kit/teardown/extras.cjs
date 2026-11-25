// Soft-read extras.json from kit/teardown.py. A missing or invalid file (for example one that
// contains NaN) must not stop the teardown: the recipe still stands without layer hints.
const { readFileSync } = require('fs');

function loadExtras(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

module.exports = { loadExtras };
