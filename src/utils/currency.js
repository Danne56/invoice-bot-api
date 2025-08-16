/**
 * Currency and amount utility functions.
 * Handles conversions between major and minor units for different currencies
 * and provides formatting for display.
 */

/**
 * Converts a currency value from its major unit (e.g., dollars) to its minor unit (e.g., cents).
 * @param {string} currency - The currency code ('USD', 'IDR').
 * @param {number|string} value - The amount in the major unit.
 * @returns {number} The amount in the minor unit.
 */
function toMinor(currency, value) {
  if (currency === 'USD') {
    const num = typeof value === 'string' ? Number(value) : value;
    return Math.round(num * 100);
  }
  // IDR is already in its base unit (rupiah), which we treat as the minor unit.
  return parseInt(value, 10);
}

/**
 * Converts a currency value from its minor unit (e.g., cents) to its major unit (e.g., dollars).
 * @param {string} currency - The currency code ('USD', 'IDR').
 * @param {number|string} minor - The amount in the minor unit.
 * @returns {number} The amount in the major unit.
 */
function toMajor(currency, minor) {
  const n = typeof minor === 'string' ? parseInt(minor, 10) : minor;
  if (currency === 'USD') {
    return Number((n / 100).toFixed(2));
  }
  return n; // IDR
}

/**
 * Validates if a given amount is valid for a specific currency.
 * @param {string} currency - The currency code ('USD', 'IDR').
 * @param {any} raw - The raw value to validate.
 * @param {object} [options] - Validation options.
 * @param {boolean} [options.allowZero=false] - Whether to allow zero as a valid amount.
 * @returns {boolean} True if the amount is valid, false otherwise.
 */
function isValidAmountByCurrency(currency, raw, { allowZero = false } = {}) {
  if (currency === 'USD') {
    // Allow numbers with up to 2 decimal places.
    const str = String(raw);
    if (!/^\d+(?:\.\d{1,2})?$/.test(str)) return false;
    const num = Number(str);
    return allowZero ? num >= 0 : num > 0;
  }
  // IDR must be an integer.
  if (!/^\d+$/.test(String(raw))) return false;
  const num = parseInt(raw, 10);
  return allowZero ? num >= 0 : num > 0;
}

/**
 * Formats a minor unit amount for display, including the appropriate currency symbol and formatting.
 * @param {string} currency - The currency code ('USD', 'IDR').
 * @param {number} minorAmount - The amount in the minor unit.
 * @returns {string} The formatted currency string.
 */
function formatAmountForDisplay(currency, minorAmount) {
  const major =
    currency === 'USD' ? Number((minorAmount / 100).toFixed(2)) : minorAmount;
  const symbol = currency === 'USD' ? '$' : 'Rp';

  if (currency === 'USD') {
    const formatted = major.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${symbol} ${formatted}`;
  } else {
    // IDR: Use Indonesian format with periods as thousand separators.
    const formatted = major.toLocaleString('id-ID').replace(/,/g, '.');
    return `${symbol}${formatted}`;
  }
}

module.exports = {
  toMinor,
  toMajor,
  isValidAmountByCurrency,
  formatAmountForDisplay,
};
