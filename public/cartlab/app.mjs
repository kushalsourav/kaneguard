import { PRODUCTS, calculateOrder, money } from './pricing.mjs';
const cart = Object.create(null);
let coupon = '';
let orderNumber = 1000;
const $ = (id) => document.getElementById(id);
function renderProducts() {
  $('products').innerHTML = PRODUCTS.map((p) => `<article class="product"><div class="product-art ${p.color}" aria-hidden="true">${p.emoji}</div><div class="product-meta"><small>${p.tag}</small><h3>${p.name}</h3><div class="product-foot"><span class="price">${money(p.priceCents)}</span><button type="button" class="add-btn" data-add="${p.id}" aria-label="Add ${p.name} to cart">+ Add to bag</button></div></div></article>`).join('');
}
function totals() {
  const data = calculateOrder(cart, coupon);
  $('totals').innerHTML = `<div class="total-row"><span>Subtotal</span><strong id="subtotal">${money(data.subtotal)}</strong></div><div class="total-row discount"><span>Discount${data.coupon ? ` (${data.coupon})` : ''}</span><strong id="discount">${data.discount ? '-' + money(data.discount) : money(0)}</strong></div><div class="total-row"><span>Shipping</span><strong id="shipping">${data.subtotal > 0 && data.shipping === 0 ? 'FREE' : money(data.shipping)}</strong></div><div class="total-row"><span>Tax (8%)</span><strong id="tax">${money(data.tax)}</strong></div><div class="total-row grand"><span>Total</span><strong id="total">${money(data.total)}</strong></div>`;
  $('checkoutButton').disabled = data.subtotal === 0;
  return data;
}
function renderCart() {
  const rows = PRODUCTS.filter((p) => (cart[p.id] ?? 0) > 0);
  const count = rows.reduce((s, p) => s + cart[p.id], 0);
  $('itemCount').textContent = `${count} item${count === 1 ? '' : 's'}`;
  $('cartItems').innerHTML = rows.length ? rows.map((p) => `<div class="cart-item"><div class="item-thumb">${p.emoji}</div><div class="item-info"><strong>${p.name}</strong><small>${money(p.priceCents)} each</small><div class="qty-controls"><button type="button" data-step="-1" data-id="${p.id}" aria-label="Decrease ${p.name} quantity">−</button><strong>${cart[p.id]}</strong><button type="button" data-step="1" data-id="${p.id}" aria-label="Increase ${p.name} quantity">+</button></div><button type="button" class="remove-btn" data-remove="${p.id}">Remove</button></div><b style="font-size:12px">${money(p.priceCents * cart[p.id])}</b></div>`).join('') : '<div class="cart-empty">Your bag is waiting.<br/>Find something worth keeping.</div>';
  totals();
}
function resetCouponMessage() { $('couponMessage').textContent = ''; $('couponMessage').className = 'coupon-message'; }
$('products').addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]'); if (!button) return;
  cart[button.dataset.add] = Math.min(99, (cart[button.dataset.add] ?? 0) + 1);
  resetCouponMessage(); renderCart();
});
$('cartItems').addEventListener('click', (event) => {
  const step = event.target.closest('[data-step]'), remove = event.target.closest('[data-remove]');
  if (step) cart[step.dataset.id] = Math.max(0, Math.min(99, (cart[step.dataset.id] || 0) + Number(step.dataset.step)));
  else if (remove) cart[remove.dataset.remove] = 0;
  else return;
  renderCart();
});
$('couponForm').addEventListener('submit', (event) => {
  event.preventDefault(); const value = $('couponInput').value.trim().toUpperCase();
  if (value === 'SAVE10' && calculateOrder(cart).subtotal > 0) {
    coupon = 'SAVE10'; $('couponMessage').textContent = '✓ SAVE10 applied: 10% off merchandise'; $('couponMessage').className = 'coupon-message success';
  } else {
    $('couponMessage').textContent = 'Invalid coupon. Try SAVE10 on a non-empty bag.'; $('couponMessage').className = 'coupon-message error';
  }
  totals();
});
$('checkoutButton').addEventListener('click', () => { $('checkoutOverlay').classList.remove('hidden'); $('checkoutFormView').classList.remove('hidden'); $('confirmation').classList.add('hidden'); });
$('closeCheckout').addEventListener('click', () => $('checkoutOverlay').classList.add('hidden'));
$('checkoutForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (calculateOrder(cart, coupon).subtotal === 0) return;
  const data = new FormData(event.target); const name = String(data.get('name') || '').trim();
  if (!name) return;
  const total = totals().total;
  $('confirmationCopy').textContent = `Thanks, ${name}! Order #CL-${++orderNumber} was placed successfully. Your confirmed total is ${money(total)}. A sample confirmation is shown here; no payment was taken.`;
  $('checkoutFormView').classList.add('hidden'); $('confirmation').classList.remove('hidden');
});
$('restartShopping').addEventListener('click', () => { for (const key of Object.keys(cart)) delete cart[key]; coupon = ''; $('couponInput').value = ''; $('checkoutOverlay').classList.add('hidden'); $('checkoutForm').reset(); resetCouponMessage(); renderCart(); });
renderProducts(); renderCart();
