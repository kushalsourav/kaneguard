import { PRODUCTS, calculateOrder, money } from './pricing.mjs';
import { getWishlist, addToWishlist, removeFromWishlist, toggleWishlist, isInWishlist } from './wishlist-store.mjs';
const cart = Object.create(null);
let coupon = '';
let orderNumber = 1000;
let searchText = '';
let selectedCategory = 'ALL';
let currentSort = 'default';
const $ = (id) => document.getElementById(id);
function getSearchInput() {
  return $('searchInput') || $('productSearch');
}
function getSortSelect() {
  return $('sortSelect') || $('sortDropdown') || $('productSort') || $('sortBy') || document.querySelector('.catalog-sort') || document.querySelector('select');
}
function getSortOrder() {
  const select = getSortSelect();
  if (!select) return currentSort;
  const val = (select.value || '').trim();
  const text = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex]?.text?.trim() : '';
  if (val === 'price-asc' || val === 'low-to-high' || val === 'Price: Low to High' || text === 'Price: Low to High' || /low.*high/i.test(val) || /low.*high/i.test(text)) {
    currentSort = 'price-asc';
    return currentSort;
  }
  if (val === 'price-desc' || val === 'high-to-low' || val === 'Price: High to Low' || text === 'Price: High to Low' || /high.*low/i.test(val) || /high.*low/i.test(text)) {
    currentSort = 'price-desc';
    return currentSort;
  }
  currentSort = 'default';
  return currentSort;
}
function resetFilters() {
  const searchEl = getSearchInput();
  if (searchEl) {
    searchEl.value = '';
  }
  searchText = '';
  const sortEl = getSortSelect();
  if (sortEl) {
    sortEl.value = 'default';
    if (sortEl.selectedIndex !== 0) {
      sortEl.selectedIndex = 0;
    }
  }
  currentSort = 'default';
  setCategory('ALL');
}
function renderProducts() {
  const searchEl = getSearchInput();
  if (searchEl) {
    searchText = searchEl.value;
  }
  const term = (searchText || '').trim().toLowerCase();
  const visible = PRODUCTS.filter((p) => {
    const matchesSearch = !term || p.name.toLowerCase().includes(term);
    const matchesCategory = selectedCategory === 'ALL' || p.tag.toUpperCase() === selectedCategory.toUpperCase();
    return matchesSearch && matchesCategory;
  });
  const sortOrder = getSortOrder();
  if (sortOrder === 'price-asc') {
    visible.sort((a, b) => a.priceCents - b.priceCents);
  } else if (sortOrder === 'price-desc') {
    visible.sort((a, b) => b.priceCents - a.priceCents);
  }
  const countEl = $('catalogCount');
  if (countEl) {
    countEl.textContent = `${visible.length} considered find${visible.length === 1 ? '' : 's'}`;
  }
  if (visible.length === 0) {
    $('products').innerHTML = `<div class="catalog-empty empty-state" id="noProductsMessage" role="status"><h3 class="empty-title">No products found</h3><p class="empty-help">Try adjusting your search or category filters.</p></div>`;
    return;
  }
  $('products').innerHTML = visible.map((p) => {
    const inWishlist = isInWishlist(p.id);
    return `<article class="product"><div class="product-art ${p.color}" aria-hidden="true">${p.emoji}</div><div class="product-meta"><small>${p.tag}</small><h3>${p.name}</h3><div class="product-foot"><span class="price">${money(p.priceCents)}</span><div class="product-actions"><button type="button" class="quick-view-btn" data-quick-view="${p.id}" data-id="${p.id}">Quick View</button><button type="button" class="wishlist-btn${inWishlist ? ' in-wishlist' : ''}" data-wishlist-add="${p.id}" data-wishlist="${p.id}" data-id="${p.id}" aria-label="${inWishlist ? '✓ In wishlist' : `Add ${p.name} to wishlist`}">${inWishlist ? '✓ In wishlist' : '+ Add to wishlist'}</button><button type="button" class="add-btn" data-add="${p.id}" data-id="${p.id}" aria-label="Add ${p.name} to cart">+ Add to bag</button></div></div></div></article>`;
  }).join('');
}
function openQuickView(id) {
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) return;
  const overlay = $('quickViewOverlay');
  if (!overlay) return;
  const nameEl = $('quickViewName');
  if (nameEl) nameEl.textContent = product.name;
  const catEl = $('quickViewCategory');
  if (catEl) catEl.textContent = product.tag;
  const priceEl = $('quickViewPrice');
  if (priceEl) priceEl.textContent = money(product.priceCents);
  const artEl = $('quickViewArt');
  if (artEl) {
    artEl.className = `product-art ${product.color}`;
    artEl.textContent = product.emoji;
  }
  overlay.dataset.productId = product.id;
  const addBtn = $('quickViewAddToCart');
  if (addBtn) {
    addBtn.dataset.productId = product.id;
    addBtn.dataset.id = product.id;
  }
  overlay.classList.remove('hidden');
}
function closeQuickView() {
  const overlay = $('quickViewOverlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}
function addQuickViewToCart() {
  const overlay = $('quickViewOverlay');
  const addBtn = $('quickViewAddToCart');
  const productId = (overlay && overlay.dataset.productId) || (addBtn && (addBtn.dataset.productId || addBtn.dataset.id));
  if (!productId) return;
  cart[productId] = Math.min(99, (cart[productId] ?? 0) + 1);
  resetCouponMessage();
  renderCart();
}
function setCategory(category) {
  selectedCategory = (category || 'ALL').toUpperCase();
  document.querySelectorAll('.category-btn').forEach((btn) => {
    const cat = (btn.dataset.category || (btn.textContent.trim().toUpperCase() === 'ALL PRODUCTS' ? 'ALL' : btn.textContent.trim())).toUpperCase();
    const active = cat === selectedCategory;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  renderProducts();
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
  const qvButton = event.target.closest('[data-quick-view], .quick-view-btn');
  if (qvButton) {
    const id = qvButton.dataset.quickView || qvButton.dataset.id;
    if (id) {
      openQuickView(id);
    }
    return;
  }
  const wishButton = event.target.closest('[data-wishlist-add], .wishlist-btn, [data-wishlist]');
  if (wishButton) {
    const id = wishButton.dataset.wishlistAdd || wishButton.dataset.wishlist || wishButton.dataset.id;
    if (id) {
      if (typeof toggleWishlist === 'function') {
        toggleWishlist(id);
      } else if (isInWishlist(id)) {
        removeFromWishlist(id);
      } else {
        addToWishlist(id);
      }
      renderProducts();
    }
    return;
  }
  const button = event.target.closest('[data-add], .add-btn');
  if (!button) return;
  const addId = button.dataset.add || button.dataset.id;
  if (!addId) return;
  cart[addId] = Math.min(99, (cart[addId] ?? 0) + 1);
  resetCouponMessage();
  renderCart();
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
const closeQuickViewBtn = $('closeQuickView');
if (closeQuickViewBtn) {
  closeQuickViewBtn.addEventListener('click', closeQuickView);
}
const quickViewAddBtn = $('quickViewAddToCart');
if (quickViewAddBtn) {
  quickViewAddBtn.addEventListener('click', addQuickViewToCart);
}
const quickViewOverlayEl = $('quickViewOverlay');
if (quickViewOverlayEl) {
  quickViewOverlayEl.addEventListener('click', (event) => {
    if (event.target === quickViewOverlayEl || event.target.closest('.quick-view-close, #closeQuickView')) {
      closeQuickView();
    }
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' || event.key === 'Esc') {
    closeQuickView();
  }
});
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
const searchInput = getSearchInput();
if (searchInput) {
  searchInput.addEventListener('input', (event) => {
    searchText = event.target.value;
    renderProducts();
  });
  searchInput.addEventListener('search', (event) => {
    searchText = event.target.value;
    renderProducts();
  });
  searchInput.addEventListener('change', (event) => {
    searchText = event.target.value;
    renderProducts();
  });
}
document.querySelectorAll('.category-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cat = btn.dataset.category || (btn.textContent.trim().toUpperCase() === 'ALL PRODUCTS' ? 'ALL' : btn.textContent.trim());
    setCategory(cat);
  });
});
const sortSelect = getSortSelect();
if (sortSelect) {
  sortSelect.addEventListener('change', () => {
    getSortOrder();
    renderProducts();
  });
  sortSelect.addEventListener('input', () => {
    getSortOrder();
    renderProducts();
  });
}
function getClearButton() {
  return $('clearFiltersBtn') || $('clearFilters') || document.querySelector('.clear-filters-btn') || document.querySelector('[data-action="clear-filters"]');
}
const clearBtn = getClearButton();
if (clearBtn) {
  clearBtn.addEventListener('click', resetFilters);
}
const toolbar = $('catalogToolbar');
if (toolbar) {
  toolbar.addEventListener('click', (event) => {
    const btn = event.target.closest('#clearFiltersBtn, #clearFilters, .clear-filters-btn, [data-action="clear-filters"]');
    if (btn) {
      resetFilters();
    }
  });
}
if (typeof window !== 'undefined') {
  window.resetFilters = resetFilters;
  window.openQuickView = openQuickView;
  window.closeQuickView = closeQuickView;
  window.addQuickViewToCart = addQuickViewToCart;
}
export { resetFilters, renderProducts, setCategory, openQuickView, closeQuickView, addQuickViewToCart };
renderProducts(); renderCart();
