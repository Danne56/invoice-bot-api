/**
 * Converts a currency value to its minor unit (e.g., cents for USD).
 * @param {string} currency - The currency code (e.g., 'USD', 'IDR').
 * @param {number|string} value - The currency value in major units.
 * @returns {number} The value in minor units.
 */
function toMinor(currency, value) {
  if (currency === 'USD') {
    const num = typeof value === 'string' ? Number(value) : value;
    return Math.round(num * 100);
  }
  // For IDR, the value is already in the smallest unit (rupiah).
  return parseInt(value, 10);
}

/**
 * Converts a currency value from its minor unit to its major unit.
 * @param {string} currency - The currency code (e.g., 'USD', 'IDR').
 * @param {number|string} minor - The value in minor units.
 * @returns {number} The value in major units.
 */
function toMajor(currency, minor) {
  const n = typeof minor === 'string' ? parseInt(minor, 10) : minor;
  if (currency === 'USD') {
    return Number((n / 100).toFixed(2));
  }
  return n; // IDR
}

/**
 * Formats a minor currency amount into a display-friendly string with a currency symbol.
 * @param {string} currency - The currency code (e.g., 'USD', 'IDR').
 * @param {number} minorAmount - The amount in minor units.
 * @returns {string} The formatted currency string (e.g., '$ 123.45', 'Rp123.456').
 */
function formatAmountForDisplay(currency, minorAmount) {
  const major = toMajor(currency, minorAmount);
  const symbol = currency === 'USD' ? '$' : 'Rp';

  if (currency === 'USD') {
    const formatted = major.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${symbol} ${formatted}`;
  } else {
    // IDR: Use Indonesian format with periods as thousand separators
    const formatted = major.toLocaleString('id-ID').replace(/,/g, '.');
    return `${symbol}${formatted}`;
  }
}

module.exports = {
  toMinor,
  toMajor,
  formatAmountForDisplay,
};
