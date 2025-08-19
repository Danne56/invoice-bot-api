const { toMajor, formatAmountForDisplay } = require('./currency');

/**
 * Formats a minor amount into major and display formats.
 * @param {string} currency - The currency code (e.g., 'IDR', 'USD').
 * @param {number|string} minorAmount - The amount in minor units.
 * @returns {{amount: number, displayAmount: string}}
 */
function formatAmount(currency, minorAmount) {
  const minor = parseInt(minorAmount || 0, 10);
  return {
    amount: toMajor(currency, minor),
    displayAmount: formatAmountForDisplay(currency, minor),
  };
}

/**
 * Formats a raw transaction object for API responses.
 * @param {object} t - The transaction object from the database.
 * @param {string} [defaultCurrency='IDR'] - The default currency to use if not specified on the transaction.
 * @returns {object} A formatted transaction object.
 */
function formatTransaction(t, defaultCurrency = 'IDR') {
  const currency = t.currency || defaultCurrency;
  const payload = {
    ...t,
    currency,
  };

  if (t.total_amount !== null && t.total_amount !== undefined) {
    const { amount, displayAmount } = formatAmount(currency, t.total_amount);
    payload.amount = amount;
    payload.displayAmount = displayAmount;
  } else {
    const { amount, displayAmount } = formatAmount(currency, 0);
    payload.amount = amount;
    payload.displayAmount = displayAmount;
  }

  if (t.subtotal !== null && t.subtotal !== undefined) {
    const { amount, displayAmount } = formatAmount(currency, t.subtotal);
    payload.subtotalAmount = amount;
    payload.subtotalDisplay = displayAmount;
  }

  if (t.tax_amount !== null && t.tax_amount !== undefined) {
    const { amount, displayAmount } = formatAmount(currency, t.tax_amount);
    payload.taxAmount = amount;
    payload.taxDisplay = displayAmount;
  }

  return payload;
}

module.exports = {
  formatTransaction,
  formatAmount,
};
