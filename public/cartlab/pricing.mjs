/** Currency is represented as integer cents. This file is an intentionally editable repair target. */
export const PRODUCTS = Object.freeze([
  { id: 'arc', name: 'Arc Wireless Headphones', tag: 'AUDIO', priceCents: 7900, emoji: '🎧', color: 'lavender' },
  { id: 'notes', name: 'Field Notes', tag: 'STATIONERY', priceCents: 2400, emoji: '📓', color: 'peach' },
  { id: 'cup', name: 'Studio Ceramic Cup', tag: 'HOME', priceCents: 1800, emoji: '☕', color: 'mint' },
  { id: 'bag', name: 'Weekender Pack', tag: 'TRAVEL', priceCents: 6400, emoji: '🎒', color: 'blue' }
]);

export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function calculateOrder(cart, coupon = '') {
  const subtotal = PRODUCTS.reduce((sum, p) => {
    const qty = Number(cart[p.id] ?? 0);
    return sum + p.priceCents * (Number.isFinite(qty) ? Math.max(0, Math.floor(qty)) : 0);
  }, 0);
  const discounted = coupon.toUpperCase() === 'SAVE10';
  const discount = discounted ? Math.round(subtotal * 0.1) : 0;
  const shipping = subtotal === 0 || subtotal >= 10000 ? 0 : 699;
  const tax = Math.round((subtotal - discount) * 0.08);
  const total = Math.max(0, subtotal - discount + shipping + tax);
  return { subtotal, discount, shipping, tax, total, coupon: discounted ? 'SAVE10' : '' };
}
