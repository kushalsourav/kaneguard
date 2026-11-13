/** Deterministic asset fixtures; no external price-feed dependency. Intentionally editable repair target. */
export const ASSETS = Object.freeze([
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', icon: '₿', price: 67000, quantity: 0.25, change: 2.44, tint: 'orange' },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', icon: '◆', price: 3200, quantity: 1.5, change: -1.08, tint: 'purple' },
  { id: 'sol', symbol: 'SOL', name: 'Solana', icon: '◎', price: 145, quantity: 12, change: 5.32, tint: 'green' },
  { id: 'link', symbol: 'LINK', name: 'Chainlink', icon: '⬡', price: 14, quantity: 6, change: 0.62, tint: 'blue' }
]);

export const parsePrice = (raw) => {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};
export const safeQuantity = (raw) => {
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};
export const assetValue = (asset, quantities = {}) => {
  const price = parsePrice(asset.price);
  return price === null ? null : price * safeQuantity(quantities[asset.id] ?? asset.quantity);
};
export const portfolioTotal = (assets, quantities = {}) => assets.reduce((sum, asset) => sum + (assetValue(asset, quantities) ?? 0), 0);
export const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
export function fixtureAssets(mode = '') {
  return ASSETS.map((asset) => mode === 'malformed' && asset.id === 'link' ? { ...asset, price: null } : { ...asset });
}
