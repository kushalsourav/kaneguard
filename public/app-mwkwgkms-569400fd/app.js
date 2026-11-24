// Sample Catalog Dataset
const products = [
  {
    id: 'prod-1',
    title: 'Wireless Headphones',
    category: 'Electronics',
    price: 50.00,
    description: 'High-fidelity audio with active noise cancellation and ergonomic ear cushions.',
    emoji: '🎧'
  },
  {
    id: 'prod-2',
    title: 'Smart Fitness Watch',
    category: 'Electronics',
    price: 120.00,
    description: 'Track your health metrics, steps, and notifications on an OLED display.',
    emoji: '⌚'
  },
  {
    id: 'prod-3',
    title: 'Bluetooth Speaker',
    category: 'Electronics',
    price: 45.00,
    description: 'Crisp portable sound with enhanced bass and IPX7 water resistance.',
    emoji: '🔊'
  },
  {
    id: 'prod-4',
    title: 'Organic Cotton T-Shirt',
    category: 'Apparel',
    price: 25.00,
    description: 'Breathable, ultra-soft crewneck t-shirt crafted from 100% organic cotton.',
    emoji: '👕'
  },
  {
    id: 'prod-5',
    title: 'Denim Jacket',
    category: 'Apparel',
    price: 80.00,
    description: 'Classic durable denim jacket featuring copper hardware and relaxed fit.',
    emoji: '🧥'
  },
  {
    id: 'prod-6',
    title: 'Running Sneakers',
    category: 'Apparel',
    price: 95.00,
    description: 'Lightweight responsive cushioning designed for road running and workouts.',
    emoji: '👟'
  },
  {
    id: 'prod-7',
    title: 'Ceramic Coffee Mug',
    category: 'Home',
    price: 15.00,
    description: 'Artisan handcrafted ceramic mug with 12oz capacity and comforting grip.',
    emoji: '☕'
  },
  {
    id: 'prod-8',
    title: 'Modern Desk Lamp',
    category: 'Home',
    price: 40.00,
    description: 'Minimalist LED desk lamp featuring adjustable brightness and touch control.',
    emoji: '💡'
  },
  {
    id: 'prod-9',
    title: 'Scented Candle',
    category: 'Home',
    price: 22.00,
    description: 'Slow-burning natural soy candle infused with cedar and amber essential oils.',
    emoji: '🕯️'
  }
];

// Cart State
let cart = [];
let currentCategory = 'All';

// DOM Elements
const productGrid = document.getElementById('product-grid');
const filterButtons = document.querySelectorAll('.filter-btn');
const cartBtn = document.getElementById('cart-btn');
const cartBadge = document.getElementById('cart-badge');
const cartDrawer = document.getElementById('cart-drawer');
const cartOverlay = document.getElementById('cart-overlay');
const cartCloseBtn = document.getElementById('cart-close-btn');
const cartItemsContainer = document.getElementById('cart-items');
const emptyCartMessage = document.getElementById('empty-cart-message');
const cartTotal = document.getElementById('cart-total');

// Render Products Grid
function renderProducts(category = 'All') {
  currentCategory = category;

  // Render product cards if not already created
  if (!productGrid.hasChildNodes() || productGrid.children.length === 0) {
    productGrid.innerHTML = '';
    products.forEach(product => {
      const card = document.createElement('article');
      card.className = 'product-card';
      card.dataset.id = product.id;
      card.dataset.category = product.category;

      card.innerHTML = `
        <div class="product-thumbnail">
          <span class="product-emoji" role="img" aria-label="${product.title}">${product.emoji}</span>
        </div>
        <div class="product-card-body">
          <div class="product-meta">
            <span class="category-badge category-${product.category.toLowerCase()}">${product.category}</span>
          </div>
          <h3 class="product-title">${product.title}</h3>
          <p class="product-description">${product.description}</p>
          <div class="product-footer">
            <span class="product-price">$${product.price.toFixed(2)}</span>
            <button class="add-to-cart-btn" data-id="${product.id}" type="button">Add to Cart</button>
          </div>
        </div>
      `;

      productGrid.appendChild(card);
    });
  }

  // Filter visible cards based on category
  filterProducts(category);
}

// Filter visible product cards based on selected category
function filterProducts(category = 'All') {
  currentCategory = category;
  const cards = productGrid.querySelectorAll('.product-card');
  const targetCategory = (category || 'All').trim().toLowerCase();

  cards.forEach(card => {
    const cardCat = (card.dataset.category || '').toLowerCase();
    const isVisible = (targetCategory === 'all') || (cardCat === targetCategory);

    if (isVisible) {
      card.classList.remove('hidden');
      card.style.display = '';
      card.hidden = false;
      card.setAttribute('aria-hidden', 'false');
    } else {
      card.classList.add('hidden');
      card.style.display = 'none';
      card.hidden = true;
      card.setAttribute('aria-hidden', 'true');
    }
  });
}

// Add Item to Cart
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      title: product.title,
      category: product.category,
      price: product.price,
      quantity: 1,
      emoji: product.emoji
    });
  }

  updateCartUI();
}

// Update Item Quantity
function updateQuantity(productId, delta) {
  const itemIndex = cart.findIndex(item => item.id === productId);
  if (itemIndex === -1) return;

  cart[itemIndex].quantity += delta;
  if (cart[itemIndex].quantity <= 0) {
    cart.splice(itemIndex, 1);
  }

  updateCartUI();
}

// Remove Item from Cart
function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  updateCartUI();
}

// Update Cart UI (Items list, badge, total, empty state)
function updateCartUI() {
  const totalItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartBadge.textContent = totalItemCount;

  const calculatedTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  cartTotal.textContent = `$${calculatedTotal.toFixed(2)}`;

  if (cart.length === 0) {
    emptyCartMessage.style.display = 'block';
    cartItemsContainer.innerHTML = '';
  } else {
    emptyCartMessage.style.display = 'none';
    cartItemsContainer.innerHTML = cart.map(item => `
      <div class="cart-item" data-id="${item.id}">
        <div class="cart-item-header">
          <h4 class="cart-item-title">${item.title}</h4>
          <div class="cart-item-unit-price">
            <span class="unit-price-label">Unit Price: </span>
            <span class="unit-price-val">$${item.price.toFixed(2)}</span>
          </div>
        </div>
        <div class="cart-item-controls">
          <div class="qty-control-group">
            <button class="qty-btn qty-dec" data-id="${item.id}" aria-label="Decrease quantity" type="button">-</button>
            <span class="cart-item-qty" data-id="${item.id}">${item.quantity}</span>
            <button class="qty-btn qty-inc" data-id="${item.id}" aria-label="Increase quantity" type="button">+</button>
          </div>
          <button class="remove-btn" data-id="${item.id}" aria-label="Remove item" type="button">Remove</button>
        </div>
      </div>
    `).join('');
  }
}

// Open and Close Cart Drawer
function openCart() {
  cartDrawer.classList.add('open');
  cartOverlay.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
  cartOverlay.setAttribute('aria-hidden', 'false');
}

function closeCart() {
  cartDrawer.classList.remove('open');
  cartOverlay.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
  cartOverlay.setAttribute('aria-hidden', 'true');
}

// Event Listeners
function setupEventListeners() {
  // Category filter buttons
  const categoryFilters = document.getElementById('category-filters');
  const buttons = document.querySelectorAll('.filter-btn');

  function handleFilterClick(category, targetBtn) {
    const selectedCategory = (category || 'All').trim();
    const lowerSelected = selectedCategory.toLowerCase();

    // Update active button styling and accessibility attributes
    buttons.forEach(btn => {
      const btnCategory = (btn.dataset.category || btn.textContent || '').trim().toLowerCase();
      const isActive = (btn === targetBtn) || (btnCategory === lowerSelected);

      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    filterProducts(selectedCategory);
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const category = btn.dataset.category || btn.textContent.trim() || 'All';
      handleFilterClick(category, btn);
    });
  });

  if (categoryFilters) {
    categoryFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (btn) {
        e.preventDefault();
        const category = btn.dataset.category || btn.textContent.trim() || 'All';
        handleFilterClick(category, btn);
      }
    });
  }

  // Product Grid Add to Cart delegation
  productGrid.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.add-to-cart-btn');
    if (addBtn) {
      const productId = addBtn.dataset.id;
      addToCart(productId);
    }
  });

  // Cart Drawer open/close
  cartBtn.addEventListener('click', openCart);
  cartCloseBtn.addEventListener('click', closeCart);
  cartOverlay.addEventListener('click', closeCart);

  // Cart Items Controls delegation (increment, decrement, remove)
  cartItemsContainer.addEventListener('click', (e) => {
    const incBtn = e.target.closest('.qty-inc');
    if (incBtn) {
      updateQuantity(incBtn.dataset.id, 1);
      return;
    }

    const decBtn = e.target.closest('.qty-dec');
    if (decBtn) {
      updateQuantity(decBtn.dataset.id, -1);
      return;
    }

    const removeBtn = e.target.closest('.remove-btn');
    if (removeBtn) {
      removeFromCart(removeBtn.dataset.id);
      return;
    }
  });

  // Keyboard accessibility: Close drawer on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cartDrawer.classList.contains('open')) {
      closeCart();
    }
  });
}

// Initialize Application
let isInitialized = false;
function initApp() {
  if (isInitialized) return;
  isInitialized = true;
  renderProducts('All');
  updateCartUI();
  setupEventListeners();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Window exports for testing and debugging
if (typeof window !== 'undefined') {
  window.products = products;
  window.cart = cart;
  window.renderProducts = renderProducts;
  window.filterProducts = filterProducts;
  window.addToCart = addToCart;
}
