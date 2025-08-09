const { customAlphabet } = require('nanoid');

// Alphabet with letters and numbers only (no symbols)
const alphabet =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// ID generator with 12 character length
function generateId(length = 12) {
  if (length < 1) {
    throw new Error('Length must be at least 1');
  }

  const generator = customAlphabet(alphabet, length);
  return generator();
}

module.exports = { generateId };
