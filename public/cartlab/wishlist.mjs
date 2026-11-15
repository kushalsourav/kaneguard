import { PRODUCTS, money } from './pricing.mjs';
import { getWishlist, removeFromWishlist } from './wishlist-store.mjs';

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export function renderWishlist() {
  const savedIds = getWishlist();
  const savedProducts = savedIds
    .map((id) => PRODUCTS.find((p) => p.id === id))
    .filter(Boolean);

  const container = $('wishlistItems');
  if (!container) return;

  const countEl = $('wishlistCount');
  if (countEl) {
    countEl.textContent = `${savedProducts.length} saved item${savedProducts.length === 1 ? '' : 's'}`;
  }

  if (savedProducts.length === 0) {
    container.innerHTML = '<div class="cart-empty" id="wishlistEmpty">Your wishlist is empty.<br/>Find something worth keeping.</div>';
    return;
  }

  container.innerHTML = savedProducts.map((p) => `
    <article class="product wishlist-card">
      <div class="product-art ${p.color}">${p.emoji}</div>
      <div class="product-meta">
        <small>${p.tag}</small>
        <h3>${p.name}</h3>
        <div class="product-foot">
          <span class="price">${money(p.priceCents)}</span>
          <button type="button" class="remove-btn" data-wishlist-remove="${p.id}" aria-label="Remove ${p.name} from wishlist">Remove</button>
        </div>
      </div>
    </article>
  `).join('');
}

if (typeof document !== 'undefined') {
  const container = $('wishlistItems');
  if (container) {
    container.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-wishlist-remove]');
      if (!btn) return;
      removeFromWishlist(btn.dataset.wishlistRemove);
      renderWishlist();
    });
  }

  renderWishlist();
}
