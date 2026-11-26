const PRODUCTS = [
  {
    id: "wireless-mouse",
    name: "Wireless Mouse",
    category: "Accessories",
    price: 799,
    rating: 4.2,
  },
  {
    id: "mechanical-keyboard",
    name: "Mechanical Keyboard",
    category: "Accessories",
    price: 2499,
    rating: 4.6,
  },
  {
    id: "usb-c-hub",
    name: "USB-C Hub",
    category: "Accessories",
    price: 1299,
    rating: 3.9,
  },
  {
    id: "monitor-27",
    name: '27" Monitor',
    category: "Displays",
    price: 14999,
    rating: 4.4,
  },
  {
    id: "monitor-24",
    name: '24" Monitor',
    category: "Displays",
    price: 9999,
    rating: 4.1,
  },
  {
    id: "noise-cancelling-headphones",
    name: "Noise-cancelling Headphones",
    category: "Audio",
    price: 5999,
    rating: 4.7,
  },
  {
    id: "bluetooth-speaker",
    name: "Bluetooth Speaker",
    category: "Audio",
    price: 2999,
    rating: 4.0,
  },
  {
    id: "webcam-hd",
    name: "Webcam HD",
    category: "Accessories",
    price: 1999,
    rating: 3.8,
  },
];

const CART_STORAGE_KEY = "gadgethub_cart";
const COUPON_STORAGE_KEY = "gadgethub_coupon";
const MIN_QTY = 1;
const MAX_QTY = 5;
const DELIVERY_FEE = 99;
const FREE_DELIVERY_THRESHOLD = 5000;
const COUPONS = {
  SAVE10: {
    code: "SAVE10",
    minSubtotal: 0,
    computeDiscount: (subtotal) => Math.round(subtotal * 10) / 100,
    description: "10% off subtotal",
  },
  GADGET500: {
    code: "GADGET500",
    minSubtotal: 3000,
    computeDiscount: (subtotal) => (subtotal >= 3000 ? 500 : 0),
    description: "₹500 off orders of ₹3000 or more",
  },
};

function findProductById(productId) {
  return PRODUCTS.find((product) => product.id === productId) || null;
}

function clampQuantity(value) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return MIN_QTY;
  return Math.min(MAX_QTY, Math.max(MIN_QTY, num));
}

function loadCart() {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && findProductById(item.productId))
      .map((item) => ({
        productId: item.productId,
        quantity: clampQuantity(item.quantity),
      }));
  } catch {
    return [];
  }
}

function saveCart(items) {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage errors if localStorage is unavailable.
  }
}

function formatCurrency(amount) {
  const rounded = Math.round(amount * 100) / 100;
  return Number.isInteger(rounded) ? `₹${rounded}` : `₹${rounded.toFixed(2)}`;
}

function loadCoupon() {
  try {
    const saved = window.localStorage.getItem(COUPON_STORAGE_KEY);
    return saved && COUPONS[saved] ? saved : null;
  } catch {
    return null;
  }
}

function saveCoupon(code) {
  try {
    if (code) {
      window.localStorage.setItem(COUPON_STORAGE_KEY, code);
    } else {
      window.localStorage.removeItem(COUPON_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors if localStorage is unavailable.
  }
}

let cartItems = [];
let activeDetailsProductId = null;
let activeCouponCode = null;
let couponFeedback = { message: "", isError: false };

function createProductCard(product) {
  const card = document.createElement("article");
  card.className = "product-card";
  card.dataset.productId = product.id;

  const top = document.createElement("div");
  top.className = "card-top";

  const category = document.createElement("span");
  category.className = "product-category";
  category.textContent = product.category;

  const rating = document.createElement("span");
  rating.className = "product-rating";
  rating.setAttribute("aria-label", `Rated ${product.rating.toFixed(1)} out of 5`);
  rating.textContent = `★ ${product.rating.toFixed(1)}`;

  top.append(category, rating);

  const name = document.createElement("h3");
  name.className = "product-name";

  const nameBtn = document.createElement("button");
  nameBtn.type = "button";
  nameBtn.className = "product-name-btn";
  nameBtn.textContent = product.name;
  nameBtn.addEventListener("click", () => openProductDetails(product.id));

  name.append(nameBtn);

  const footer = document.createElement("div");
  footer.className = "card-footer";

  const price = document.createElement("span");
  price.className = "product-price";
  price.textContent = `₹${product.price}`;

  footer.append(price);
  card.append(top, name, footer);
  return card;
}

const catalogState = {
  search: "",
  category: "All",
  minRating: false,
  sort: "default",
};

function getFilteredAndSortedProducts() {
  const query = catalogState.search.trim().toLowerCase();

  const filtered = PRODUCTS.filter((product) => {
    const matchesSearch = !query || product.name.toLowerCase().includes(query);
    const matchesCategory =
      catalogState.category === "All" || product.category === catalogState.category;
    const matchesRating = !catalogState.minRating || product.rating >= 4.0;
    return matchesSearch && matchesCategory && matchesRating;
  });

  if (catalogState.sort === "price-asc") {
    return [...filtered].sort((a, b) => a.price - b.price);
  }
  if (catalogState.sort === "price-desc") {
    return [...filtered].sort((a, b) => b.price - a.price);
  }
  if (catalogState.sort === "rating-desc") {
    return [...filtered].sort((a, b) => b.rating - a.rating);
  }
  return filtered;
}

function renderCatalog(products) {
  const countEl = document.getElementById("product-count");
  const listEl = document.getElementById("product-list");
  const emptyEl = document.getElementById("empty-state");

  if (!countEl || !listEl) return;

  const label = products.length === 1 ? "product" : "products";
  countEl.textContent = `Showing ${products.length} ${label}`;

  listEl.replaceChildren(...products.map(createProductCard));

  if (emptyEl) {
    emptyEl.hidden = products.length > 0;
  }
}

function updateCatalogView() {
  renderCatalog(getFilteredAndSortedProducts());
}

function bindCatalogControls() {
  const searchInput = document.getElementById("search-input");
  const ratingFilter = document.getElementById("rating-filter");
  const sortSelect = document.getElementById("sort-select");
  const categoryButtons = document.querySelectorAll(".category-btn");

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      catalogState.search = event.target.value;
      updateCatalogView();
    });
  }

  if (ratingFilter) {
    ratingFilter.addEventListener("change", (event) => {
      catalogState.minRating = event.target.checked;
      updateCatalogView();
    });
  }

  if (sortSelect) {
    sortSelect.addEventListener("change", (event) => {
      catalogState.sort = event.target.value;
      updateCatalogView();
    });
  }

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.category || "All";
      catalogState.category = selected;

      categoryButtons.forEach((btn) => {
        const isActive = btn === button;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", String(isActive));
      });

      updateCatalogView();
    });
  });
}

function openProductDetails(productId) {
  const product = findProductById(productId);
  const panel = document.getElementById("product-details");
  const nameEl = document.getElementById("details-name");
  const categoryEl = document.getElementById("details-category");
  const ratingEl = document.getElementById("details-rating");
  const priceEl = document.getElementById("details-price");
  const qtySelect = document.getElementById("details-qty");
  const feedbackEl = document.getElementById("details-feedback");

  if (!product || !panel) return;

  activeDetailsProductId = product.id;
  if (nameEl) nameEl.textContent = product.name;
  if (categoryEl) categoryEl.textContent = product.category;
  if (ratingEl) {
    ratingEl.setAttribute("aria-label", `Rated ${product.rating.toFixed(1)} out of 5`);
    ratingEl.textContent = `★ ${product.rating.toFixed(1)}`;
  }
  if (priceEl) priceEl.textContent = `₹${product.price}`;
  if (qtySelect) qtySelect.value = "1";
  if (feedbackEl) {
    feedbackEl.textContent = "";
    feedbackEl.hidden = true;
  }

  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeProductDetails() {
  const panel = document.getElementById("product-details");
  const feedbackEl = document.getElementById("details-feedback");
  activeDetailsProductId = null;
  if (feedbackEl) {
    feedbackEl.textContent = "";
    feedbackEl.hidden = true;
  }
  if (panel) panel.hidden = true;
}

function getCartTotalCount() {
  return cartItems.reduce((sum, item) => sum + item.quantity, 0);
}

function updateCartBadge() {
  const countEl = document.getElementById("cart-count");
  if (countEl) {
    countEl.textContent = String(getCartTotalCount());
  }
}

function addProductToCart(productId, quantity) {
  const product = findProductById(productId);
  if (!product) return;

  const qtyToAdd = clampQuantity(quantity);
  const existing = cartItems.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity = Math.min(MAX_QTY, existing.quantity + qtyToAdd);
  } else {
    cartItems.push({ productId, quantity: qtyToAdd });
  }

  couponFeedback = { message: "", isError: false };
  saveCart(cartItems);
  updateCartBadge();
  renderCart();
}

function setCartItemQuantity(productId, nextQuantity) {
  const existing = cartItems.find((item) => item.productId === productId);
  if (!existing) return;

  existing.quantity = clampQuantity(nextQuantity);
  couponFeedback = { message: "", isError: false };
  saveCart(cartItems);
  updateCartBadge();
  renderCart();
}

function removeCartItem(productId) {
  cartItems = cartItems.filter((item) => item.productId !== productId);
  couponFeedback = { message: "", isError: false };
  saveCart(cartItems);
  updateCartBadge();
  renderCart();
}

function getCartSubtotal() {
  return cartItems.reduce((sum, item) => {
    const product = findProductById(item.productId);
    return product ? sum + product.price * item.quantity : sum;
  }, 0);
}

function applyCoupon(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) {
    couponFeedback = { message: "Please enter a coupon code.", isError: true };
    renderCart();
    return;
  }

  const coupon = COUPONS[code];
  if (!coupon) {
    couponFeedback = {
      message: "Invalid coupon code. Try SAVE10 or GADGET500.",
      isError: true,
    };
    renderCart();
    return;
  }

  const subtotal = getCartSubtotal();
  if (subtotal < coupon.minSubtotal) {
    couponFeedback = {
      message: `${coupon.code} requires a subtotal of ₹${coupon.minSubtotal} or more.`,
      isError: true,
    };
    renderCart();
    return;
  }

  const replacedPrevious = Boolean(activeCouponCode && activeCouponCode !== coupon.code);
  activeCouponCode = coupon.code;
  saveCoupon(activeCouponCode);
  couponFeedback = {
    message: replacedPrevious
      ? `Replaced previous coupon with ${coupon.code} (${coupon.description}).`
      : `Coupon ${coupon.code} applied (${coupon.description}).`,
    isError: false,
  };
  renderCart();
}

function clearCoupon() {
  if (!activeCouponCode) return;
  const inputEl = document.getElementById("coupon-input");
  activeCouponCode = null;
  saveCoupon(null);
  if (inputEl) inputEl.value = "";
  couponFeedback = { message: "Coupon cleared.", isError: false };
  renderCart();
}

function createCartItemRow(item, product) {
  const row = document.createElement("article");
  row.className = "cart-item";
  row.dataset.productId = product.id;

  const info = document.createElement("div");
  info.className = "cart-item-info";

  const name = document.createElement("h3");
  name.className = "cart-item-name";
  name.textContent = product.name;

  const unit = document.createElement("p");
  unit.className = "cart-item-unit";
  unit.textContent = `₹${product.price} each`;

  info.append(name, unit);

  const controls = document.createElement("div");
  controls.className = "cart-item-controls";

  const stepper = document.createElement("div");
  stepper.className = "qty-stepper";

  const decreaseBtn = document.createElement("button");
  decreaseBtn.type = "button";
  decreaseBtn.className = "qty-btn";
  decreaseBtn.textContent = "−";
  decreaseBtn.setAttribute("aria-label", `Decrease quantity of ${product.name}`);
  if (item.quantity <= MIN_QTY) {
    decreaseBtn.setAttribute("aria-disabled", "true");
    decreaseBtn.classList.add("is-disabled");
  }
  decreaseBtn.addEventListener("click", () => {
    setCartItemQuantity(product.id, item.quantity - 1);
  });

  const qtyText = document.createElement("span");
  qtyText.className = "cart-item-qty";
  qtyText.setAttribute("aria-label", `Quantity of ${product.name}`);
  qtyText.textContent = String(item.quantity);

  const increaseBtn = document.createElement("button");
  increaseBtn.type = "button";
  increaseBtn.className = "qty-btn";
  increaseBtn.textContent = "+";
  increaseBtn.setAttribute("aria-label", `Increase quantity of ${product.name}`);
  if (item.quantity >= MAX_QTY) {
    increaseBtn.setAttribute("aria-disabled", "true");
    increaseBtn.classList.add("is-disabled");
  }
  increaseBtn.addEventListener("click", () => {
    setCartItemQuantity(product.id, item.quantity + 1);
  });

  stepper.append(decreaseBtn, qtyText, increaseBtn);

  const lineTotal = document.createElement("span");
  lineTotal.className = "cart-item-line-total";
  lineTotal.textContent = `₹${product.price * item.quantity}`;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove";
  removeBtn.setAttribute("aria-label", `Remove ${product.name}`);
  removeBtn.addEventListener("click", () => {
    removeCartItem(product.id);
  });

  controls.append(stepper, lineTotal, removeBtn);
  row.append(info, controls);
  return row;
}

function renderCart() {
  const emptyEl = document.getElementById("cart-empty");
  const contentEl = document.getElementById("cart-content");
  const listEl = document.getElementById("cart-items");
  const subtotalEl = document.getElementById("cart-subtotal");
  const discountRowEl = document.getElementById("cart-discount-row");
  const discountEl = document.getElementById("cart-discount");
  const deliveryEl = document.getElementById("cart-delivery");
  const deliveryHintEl = document.getElementById("cart-delivery-hint");
  const totalEl = document.getElementById("cart-total");
  const activeCouponEl = document.getElementById("active-coupon");
  const activeCouponCodeEl = document.getElementById("active-coupon-code");
  const couponFeedbackEl = document.getElementById("coupon-feedback");

  if (!emptyEl || !contentEl || !listEl) return;

  if (cartItems.length === 0) {
    activeCouponCode = null;
    saveCoupon(null);
    couponFeedback = { message: "", isError: false };
    emptyEl.hidden = false;
    contentEl.hidden = true;
    listEl.replaceChildren();
    return;
  }

  emptyEl.hidden = true;
  contentEl.hidden = false;

  const rows = [];
  let subtotal = 0;

  cartItems.forEach((item) => {
    const product = findProductById(item.productId);
    if (!product) return;
    subtotal += product.price * item.quantity;
    rows.push(createCartItemRow(item, product));
  });

  listEl.replaceChildren(...rows);

  if (activeCouponCode) {
    const activeCoupon = COUPONS[activeCouponCode];
    if (!activeCoupon || subtotal < activeCoupon.minSubtotal) {
      const removedCode = activeCouponCode;
      activeCouponCode = null;
      saveCoupon(null);
      if (activeCoupon) {
        couponFeedback = {
          message: `${removedCode} was removed because the subtotal is below ₹${activeCoupon.minSubtotal}.`,
          isError: true,
        };
      }
    }
  }

  const appliedCoupon = activeCouponCode ? COUPONS[activeCouponCode] : null;
  const discount = appliedCoupon
    ? Math.min(subtotal, appliedCoupon.computeDiscount(subtotal))
    : 0;
  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  const grandTotal = Math.max(0, subtotal - discount) + deliveryFee;

  if (activeCouponEl && activeCouponCodeEl) {
    activeCouponEl.hidden = !appliedCoupon;
    activeCouponCodeEl.textContent = appliedCoupon ? appliedCoupon.code : "";
  }

  if (discountRowEl && discountEl) {
    discountRowEl.hidden = !appliedCoupon;
    discountEl.textContent = appliedCoupon ? `-${formatCurrency(discount)}` : "₹0";
  }

  if (couponFeedbackEl) {
    if (couponFeedback.message) {
      couponFeedbackEl.textContent = couponFeedback.message;
      couponFeedbackEl.classList.toggle("is-error", couponFeedback.isError);
      couponFeedbackEl.classList.toggle("is-success", !couponFeedback.isError);
      couponFeedbackEl.hidden = false;
    } else {
      couponFeedbackEl.textContent = "";
      couponFeedbackEl.classList.remove("is-error", "is-success");
      couponFeedbackEl.hidden = true;
    }
  }

  if (subtotalEl) subtotalEl.textContent = formatCurrency(subtotal);
  if (deliveryEl) deliveryEl.textContent = deliveryFee === 0 ? "Free" : formatCurrency(deliveryFee);
  if (deliveryHintEl) {
    deliveryHintEl.textContent =
      deliveryFee === 0
        ? `Free delivery applied on orders of ₹${FREE_DELIVERY_THRESHOLD} or more.`
        : `Add ${formatCurrency(FREE_DELIVERY_THRESHOLD - subtotal)} more for free delivery.`;
  }
  if (totalEl) totalEl.textContent = formatCurrency(grandTotal);
}

function showView(view) {
  const catalogSection = document.getElementById("catalog-section");
  const cartSection = document.getElementById("cart-section");
  if (!catalogSection || !cartSection) return;

  const isCart = view === "cart";
  catalogSection.hidden = isCart;
  cartSection.hidden = !isCart;

  if (isCart) {
    renderCart();
  }
}

function syncViewFromHash() {
  showView(window.location.hash === "#cart" ? "cart" : "catalog");
}

function bindDetailsAndCartControls() {
  const detailsCloseBtn = document.getElementById("details-close-btn");
  const detailsAddBtn = document.getElementById("details-add-btn");
  const detailsQtySelect = document.getElementById("details-qty");
  const detailsFeedbackEl = document.getElementById("details-feedback");
  const cartToggleBtn = document.getElementById("cart-toggle-btn");
  const backToCatalogBtn = document.getElementById("back-to-catalog-btn");
  const emptyBrowseBtn = document.getElementById("empty-browse-btn");
  const brandLink = document.getElementById("brand-link");
  const couponForm = document.getElementById("coupon-form");
  const couponInput = document.getElementById("coupon-input");
  const couponClearBtn = document.getElementById("coupon-clear-btn");

  if (detailsCloseBtn) {
    detailsCloseBtn.addEventListener("click", closeProductDetails);
  }

  if (detailsAddBtn) {
    detailsAddBtn.addEventListener("click", () => {
      if (!activeDetailsProductId) return;
      const product = findProductById(activeDetailsProductId);
      const qty = detailsQtySelect ? clampQuantity(detailsQtySelect.value) : 1;
      addProductToCart(activeDetailsProductId, qty);

      if (detailsFeedbackEl && product) {
        detailsFeedbackEl.textContent = `Added ${qty} × ${product.name} to cart.`;
        detailsFeedbackEl.hidden = false;
      }
    });
  }

  if (cartToggleBtn) {
    cartToggleBtn.addEventListener("click", () => {
      if (window.location.hash !== "#cart") {
        window.location.hash = "#cart";
      } else {
        showView("cart");
      }
    });
  }

  const navigateToCatalog = (event) => {
    if (event) event.preventDefault();
    if (window.location.hash === "#cart") {
      window.location.hash = "#catalog";
    } else {
      showView("catalog");
    }
  };

  if (backToCatalogBtn) {
    backToCatalogBtn.addEventListener("click", navigateToCatalog);
  }

  if (emptyBrowseBtn) {
    emptyBrowseBtn.addEventListener("click", navigateToCatalog);
  }

  if (brandLink) {
    brandLink.addEventListener("click", navigateToCatalog);
  }

  if (couponForm) {
    couponForm.addEventListener("submit", (event) => {
      event.preventDefault();
      applyCoupon(couponInput ? couponInput.value : "");
    });
  }

  if (couponClearBtn) {
    couponClearBtn.addEventListener("click", clearCoupon);
  }

  window.addEventListener("hashchange", syncViewFromHash);
}

document.addEventListener("DOMContentLoaded", () => {
  cartItems = loadCart();
  activeCouponCode = loadCoupon();
  updateCartBadge();
  bindCatalogControls();
  bindDetailsAndCartControls();
  updateCatalogView();
  syncViewFromHash();
});
