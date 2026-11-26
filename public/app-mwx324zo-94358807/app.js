(() => {
  "use strict";

  /**
   * Fixed product catalog for CartLedger.
   * Prices are in USD and stock represents maximum purchasable quantity.
   */
  const CATALOG = [
    {
      id: "notebook",
      name: "Notebook",
      price: 18,
      stock: 4,
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`
    },
    {
      id: "pen",
      name: "Pen",
      price: 5,
      stock: 10,
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>`
    },
    {
      id: "bag",
      name: "Bag",
      price: 32,
      stock: 2,
      icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/></svg>`
    }
  ];

  const COUPON_CODE = "SAVE10";
  const COUPON_MIN_SUBTOTAL_CENTS = 5000;
  const COUPON_DISCOUNT_RATE = 0.1;
  const FREE_SHIPPING_THRESHOLD_CENTS = 6000;
  const STANDARD_SHIPPING_CENTS = 600;
  const TAX_RATE = 0.08;
  const STORAGE_KEY = "cartledger.state.v1";

  const CATALOG_BY_ID = new Map(CATALOG.map((product) => [product.id, product]));
  const cartQuantities = new Map();
  let appliedCouponCode = "";
  let couponNotice = { message: "", tone: "info" };

  function saveState() {
    try {
      const quantities = {};
      for (const product of CATALOG) {
        const qty = cartQuantities.get(product.id) || 0;
        if (qty > 0) {
          quantities[product.id] = qty;
        }
      }

      const payload = {
        quantities,
        couponCode: appliedCouponCode
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures when localStorage is restricted or unavailable.
    }
  }

  function clearPersistedState() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures when localStorage is restricted or unavailable.
    }
  }

  function restorePersistedState() {
    cartQuantities.clear();
    appliedCouponCode = "";
    couponNotice = { message: "", tone: "info" };

    let rawState = null;
    try {
      rawState = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return;
    }

    if (!rawState) return;

    let parsed;
    try {
      parsed = JSON.parse(rawState);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== "object") return;

    if (parsed.quantities && typeof parsed.quantities === "object") {
      for (const product of CATALOG) {
        const storedQty = parsed.quantities[product.id];
        if (typeof storedQty === "number" && Number.isInteger(storedQty) && storedQty > 0) {
          cartQuantities.set(product.id, Math.min(storedQty, product.stock));
        }
      }
    }

    if (typeof parsed.couponCode === "string") {
      const normalized = parsed.couponCode.trim().toUpperCase();
      if (normalized === COUPON_CODE) {
        appliedCouponCode = COUPON_CODE;
      }
    }

    const couponInput = document.getElementById("coupon-input");
    if (couponInput) {
      couponInput.value = appliedCouponCode;
    }
  }

  function formatCurrency(amount) {
    return `$${amount.toFixed(2)}`;
  }

  function formatCents(cents) {
    return formatCurrency(cents / 100);
  }

  function formatItemCount(count) {
    return `${count} ${count === 1 ? "item" : "items"}`;
  }

  function createProductCard(product) {
    const article = document.createElement("article");
    article.className = "product-card";
    article.setAttribute("role", "listitem");
    article.dataset.productId = product.id;

    article.innerHTML = `
      <div>
        <div class="product-icon">${product.icon}</div>
        <h3 class="product-name">${product.name}</h3>
        <div class="product-meta">
          <span class="product-price" aria-label="Price ${formatCurrency(product.price)}">${formatCurrency(product.price)}</span>
          <span class="product-stock" aria-label="${product.stock} in stock">Stock: ${product.stock}</span>
        </div>
      </div>
      <button
        type="button"
        class="btn btn-primary add-to-cart-btn"
        data-product-id="${product.id}"
        aria-label="Add ${product.name} to cart"
      >
        Add to Cart
      </button>
    `;

    return article;
  }

  function renderCatalog() {
    const catalogGrid = document.getElementById("catalog-grid");
    if (!catalogGrid) return;

    catalogGrid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const product of CATALOG) {
      fragment.appendChild(createProductCard(product));
    }
    catalogGrid.appendChild(fragment);
  }

  function getTotalCartCount() {
    let total = 0;
    for (const qty of cartQuantities.values()) {
      total += qty;
    }
    return total;
  }

  function updateCartBadge(totalCount) {
    const badge = document.getElementById("cart-count-badge");
    if (!badge) return;

    const label = formatItemCount(totalCount);
    badge.textContent = label;
    badge.setAttribute("aria-label", `${label} in cart`);
  }

  function announceCartFeedback(message, tone = "info") {
    const feedback = document.getElementById("cart-feedback");
    if (!feedback) return;
    feedback.dataset.tone = tone;
    feedback.textContent = message;
  }

  function updateCatalogStockStates() {
    const catalogGrid = document.getElementById("catalog-grid");
    if (!catalogGrid) return;

    for (const product of CATALOG) {
      const button = catalogGrid.querySelector(
        `.add-to-cart-btn[data-product-id="${product.id}"]`
      );
      if (!button) continue;

      const currentQty = cartQuantities.get(product.id) || 0;
      const isAtLimit = currentQty >= product.stock;
      button.classList.toggle("is-at-limit", isAtLimit);
      if (isAtLimit) {
        button.setAttribute("aria-disabled", "true");
      } else {
        button.removeAttribute("aria-disabled");
      }
    }
  }

  function createCartItemElement(product, quantity) {
    const item = document.createElement("li");
    item.className = "cart-item";
    item.dataset.productId = product.id;

    const lineTotal = product.price * quantity;
    const isAtLimit = quantity >= product.stock;
    const limitNote = isAtLimit
      ? `<span class="cart-item-limit-note">Max stock reached (${product.stock} available)</span>`
      : "";

    item.innerHTML = `
      <div class="cart-item-main">
        <div class="cart-item-info">
          <span class="cart-item-name">${product.name}</span>
          <span class="cart-item-meta">${formatCurrency(product.price)} each &middot; Stock: ${product.stock}</span>
          ${limitNote}
        </div>
        <span class="cart-item-subtotal">${formatCurrency(lineTotal)}</span>
      </div>
      <div class="cart-item-controls" role="group" aria-label="${product.name} quantity controls">
        <button
          type="button"
          class="qty-btn qty-decrease-btn"
          data-product-id="${product.id}"
          data-action="decrease"
          aria-label="Decrease ${product.name} quantity"
        >&minus;</button>
        <span class="qty-value" aria-label="${product.name} quantity">${quantity}</span>
        <button
          type="button"
          class="qty-btn qty-increase-btn${isAtLimit ? " is-at-limit" : ""}"
          data-product-id="${product.id}"
          data-action="increase"
          aria-label="Increase ${product.name} quantity"
          ${isAtLimit ? 'aria-disabled="true"' : ""}
        >+</button>
      </div>
    `;

    return item;
  }

  function getFocusedCartControl(cartContent) {
    const active = document.activeElement;
    if (!active || !cartContent.contains(active)) return null;
    const button = active.closest(".qty-btn[data-product-id][data-action]");
    if (!button) return null;
    return {
      productId: button.dataset.productId,
      action: button.dataset.action
    };
  }

  function restoreCartFocus(cartContent, previousControl) {
    if (!previousControl) return;

    const sameButton = cartContent.querySelector(
      `.qty-btn[data-product-id="${previousControl.productId}"][data-action="${previousControl.action}"]`
    );
    if (sameButton) {
      sameButton.focus({ preventScroll: true });
      return;
    }

    const fallbackButton = cartContent.querySelector(".qty-btn");
    if (fallbackButton) {
      fallbackButton.focus({ preventScroll: true });
      return;
    }

    const cartHeading = document.getElementById("cart-heading");
    if (cartHeading) {
      cartHeading.focus({ preventScroll: true });
    }
  }

  function calculateSubtotalCents() {
    let subtotalCents = 0;
    for (const product of CATALOG) {
      const quantity = cartQuantities.get(product.id) || 0;
      if (quantity > 0) {
        subtotalCents += product.price * 100 * quantity;
      }
    }
    return subtotalCents;
  }

  function calculateOrderTotals(subtotalCents, couponCode) {
    const hasItems = subtotalCents > 0;
    const isCouponEntered = couponCode === COUPON_CODE;
    const isCouponEligible =
      hasItems && isCouponEntered && subtotalCents >= COUPON_MIN_SUBTOTAL_CENTS;

    const discountCents = isCouponEligible
      ? Math.round(subtotalCents * COUPON_DISCOUNT_RATE)
      : 0;
    const discountedSubtotalCents = subtotalCents - discountCents;
    const shippingCents = !hasItems
      ? 0
      : subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS
        ? 0
        : STANDARD_SHIPPING_CENTS;
    const taxCents = Math.round(discountedSubtotalCents * TAX_RATE);
    const grandTotalCents = discountedSubtotalCents + shippingCents + taxCents;

    return {
      subtotalCents,
      discountCents,
      discountedSubtotalCents,
      shippingCents,
      taxCents,
      grandTotalCents,
      hasItems,
      isCouponEntered,
      isCouponEligible
    };
  }

  function getCouponFeedback(totals) {
    if (totals.isCouponEntered) {
      if (totals.isCouponEligible) {
        return {
          message: `Coupon ${COUPON_CODE} applied: 10% off merchandise (${formatCents(totals.discountCents)} saved).`,
          tone: "success"
        };
      }
      if (!totals.hasItems) {
        return {
          message: `Coupon ${COUPON_CODE} is ineligible: add at least ${formatCents(COUPON_MIN_SUBTOTAL_CENTS)} in merchandise to apply this discount. No discount applied.`,
          tone: "warning"
        };
      }
      const remainingCents = COUPON_MIN_SUBTOTAL_CENTS - totals.subtotalCents;
      return {
        message: `Coupon ${COUPON_CODE} is ineligible: merchandise subtotal must be at least ${formatCents(COUPON_MIN_SUBTOTAL_CENTS)} (${formatCents(remainingCents)} more needed). No discount applied.`,
        tone: "warning"
      };
    }

    return couponNotice;
  }

  function renderOrderAndCouponSummary() {
    const subtotalCents = calculateSubtotalCents();
    const totals = calculateOrderTotals(subtotalCents, appliedCouponCode);

    const subtotalEl = document.getElementById("summary-subtotal");
    const discountLabelEl = document.getElementById("summary-discount-label");
    const discountEl = document.getElementById("summary-discount");
    const shippingEl = document.getElementById("summary-shipping");
    const taxEl = document.getElementById("summary-tax");
    const grandTotalEl = document.getElementById("summary-grand-total");
    const shippingNoteEl = document.getElementById("shipping-note");
    const removeCouponBtn = document.getElementById("remove-coupon-btn");
    const couponFeedbackEl = document.getElementById("coupon-feedback");

    if (subtotalEl) subtotalEl.textContent = formatCents(totals.subtotalCents);
    if (discountLabelEl) {
      discountLabelEl.textContent = totals.isCouponEligible
        ? `Discount (${COUPON_CODE})`
        : "Discount";
    }
    if (discountEl) {
      discountEl.textContent = formatCents(totals.discountCents);
      discountEl.classList.toggle("is-discount-active", totals.discountCents > 0);
    }
    if (shippingEl) shippingEl.textContent = formatCents(totals.shippingCents);
    if (taxEl) taxEl.textContent = formatCents(totals.taxCents);
    if (grandTotalEl) grandTotalEl.textContent = formatCents(totals.grandTotalCents);

    if (shippingNoteEl) {
      if (!totals.hasItems) {
        shippingNoteEl.textContent =
          "Free shipping on orders of $60.00 or more (before discount); otherwise $6.00.";
      } else if (totals.shippingCents === 0) {
        shippingNoteEl.textContent =
          "Free shipping applied (pre-discount subtotal is $60.00 or more).";
      } else {
        const neededCents = FREE_SHIPPING_THRESHOLD_CENTS - totals.subtotalCents;
        shippingNoteEl.textContent = `Add ${formatCents(neededCents)} more (before discount) for free shipping.`;
      }
    }

    if (removeCouponBtn) {
      removeCouponBtn.hidden = !totals.isCouponEntered;
    }

    if (couponFeedbackEl) {
      const feedback = getCouponFeedback(totals);
      couponFeedbackEl.dataset.tone = feedback.tone;
      couponFeedbackEl.textContent = feedback.message;
    }
  }

  function renderCart(emptyStateTemplate) {
    const cartContent = document.getElementById("cart-content");
    const totalCount = getTotalCartCount();
    updateCartBadge(totalCount);
    updateCatalogStockStates();

    if (!cartContent) {
      renderOrderAndCouponSummary();
      return;
    }

    const previousControl = getFocusedCartControl(cartContent);

    if (totalCount === 0) {
      if (!document.getElementById("cart-empty") && emptyStateTemplate) {
        cartContent.replaceChildren(emptyStateTemplate.cloneNode(true));
      }
      restoreCartFocus(cartContent, previousControl);
      renderOrderAndCouponSummary();
      return;
    }

    const list = document.createElement("ul");
    list.className = "cart-items";
    list.setAttribute("aria-label", "Cart items");

    for (const product of CATALOG) {
      const quantity = cartQuantities.get(product.id) || 0;
      if (quantity <= 0) continue;
      list.appendChild(createCartItemElement(product, quantity));
    }

    cartContent.replaceChildren(list);
    restoreCartFocus(cartContent, previousControl);
    renderOrderAndCouponSummary();
  }

  function handleIncreaseQuantity(productId, emptyStateTemplate) {
    const product = CATALOG_BY_ID.get(productId);
    if (!product) return;

    const currentQty = cartQuantities.get(product.id) || 0;
    if (currentQty >= product.stock) {
      announceCartFeedback(
        `Cannot add more ${product.name}. Maximum stock of ${product.stock} reached.`,
        "warning"
      );
      return;
    }

    const nextQty = currentQty + 1;
    cartQuantities.set(product.id, nextQty);
    saveState();
    renderCart(emptyStateTemplate);

    const totalCount = getTotalCartCount();
    if (nextQty === product.stock) {
      announceCartFeedback(
        `${product.name} quantity is now ${nextQty} (maximum stock of ${product.stock} reached). ${formatItemCount(totalCount)} total.`,
        "info"
      );
      return;
    }

    const actionVerb = currentQty === 0
      ? `Added ${product.name} to cart.`
      : `Updated ${product.name} quantity to ${nextQty}.`;
    announceCartFeedback(
      `${actionVerb} ${nextQty} in cart. ${formatItemCount(totalCount)} total.`,
      "info"
    );
  }

  function handleDecreaseQuantity(productId, emptyStateTemplate) {
    const product = CATALOG_BY_ID.get(productId);
    if (!product) return;

    const currentQty = cartQuantities.get(product.id) || 0;
    if (currentQty <= 0) return;

    const nextQty = currentQty - 1;
    if (nextQty === 0) {
      cartQuantities.delete(product.id);
      saveState();
      renderCart(emptyStateTemplate);
      const totalCount = getTotalCartCount();
      const suffix = totalCount === 0
        ? "Your cart is now empty."
        : `${formatItemCount(totalCount)} total.`;
      announceCartFeedback(`Removed ${product.name} from cart. ${suffix}`, "info");
      return;
    }

    cartQuantities.set(product.id, nextQty);
    saveState();
    renderCart(emptyStateTemplate);
    const totalCount = getTotalCartCount();
    announceCartFeedback(
      `Updated ${product.name} quantity to ${nextQty}. ${formatItemCount(totalCount)} total.`,
      "info"
    );
  }

  function handleCouponSubmit(event) {
    event.preventDefault();
    const input = document.getElementById("coupon-input");
    const rawCode = input ? input.value.trim() : "";
    const normalizedCode = rawCode.toUpperCase();

    if (!normalizedCode) {
      appliedCouponCode = "";
      couponNotice = {
        message: `Please enter a coupon code (e.g. ${COUPON_CODE}). No discount applied.`,
        tone: "warning"
      };
      saveState();
      renderOrderAndCouponSummary();
      return;
    }

    if (normalizedCode !== COUPON_CODE) {
      appliedCouponCode = "";
      couponNotice = {
        message: `Coupon "${rawCode}" is invalid. Use ${COUPON_CODE} for 10% off orders of $50.00 or more. No discount applied.`,
        tone: "warning"
      };
      saveState();
      renderOrderAndCouponSummary();
      return;
    }

    appliedCouponCode = COUPON_CODE;
    couponNotice = { message: "", tone: "info" };
    if (input) {
      input.value = COUPON_CODE;
    }
    saveState();
    renderOrderAndCouponSummary();
  }

  function handleRemoveCoupon() {
    appliedCouponCode = "";
    couponNotice = {
      message: "Coupon removed.",
      tone: "info"
    };
    const input = document.getElementById("coupon-input");
    if (input) {
      input.value = "";
      input.focus({ preventScroll: true });
    }
    saveState();
    renderOrderAndCouponSummary();
  }

  function handleResetCart(emptyStateTemplate) {
    cartQuantities.clear();
    appliedCouponCode = "";
    couponNotice = { message: "", tone: "info" };

    const input = document.getElementById("coupon-input");
    if (input) {
      input.value = "";
    }

    clearPersistedState();
    renderCart(emptyStateTemplate);
    announceCartFeedback(
      "Cart reset. All items, coupon state, and saved data have been cleared.",
      "info"
    );
  }

  function init() {
    renderCatalog();

    const emptyEl = document.getElementById("cart-empty");
    const emptyStateTemplate = emptyEl ? emptyEl.cloneNode(true) : null;
    restorePersistedState();
    renderCart(emptyStateTemplate);

    const catalogGrid = document.getElementById("catalog-grid");
    if (catalogGrid) {
      catalogGrid.addEventListener("click", (event) => {
        const button = event.target.closest(".add-to-cart-btn[data-product-id]");
        if (!button || !catalogGrid.contains(button)) return;
        handleIncreaseQuantity(button.dataset.productId, emptyStateTemplate);
      });
    }

    const cartContent = document.getElementById("cart-content");
    if (cartContent) {
      cartContent.addEventListener("click", (event) => {
        const button = event.target.closest(".qty-btn[data-product-id][data-action]");
        if (!button || !cartContent.contains(button)) return;

        const { productId, action } = button.dataset;
        if (action === "increase") {
          handleIncreaseQuantity(productId, emptyStateTemplate);
        } else if (action === "decrease") {
          handleDecreaseQuantity(productId, emptyStateTemplate);
        }
      });
    }

    const couponForm = document.getElementById("coupon-form");
    if (couponForm) {
      couponForm.addEventListener("submit", handleCouponSubmit);
    }

    const removeCouponBtn = document.getElementById("remove-coupon-btn");
    if (removeCouponBtn) {
      removeCouponBtn.addEventListener("click", handleRemoveCoupon);
    }

    const resetCartBtn = document.getElementById("reset-cart-btn");
    if (resetCartBtn) {
      resetCartBtn.addEventListener("click", () => {
        handleResetCart(emptyStateTemplate);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
