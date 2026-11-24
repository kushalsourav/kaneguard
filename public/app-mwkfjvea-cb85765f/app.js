/**
 * Velvet Roast Coffeehouse - Interactive Landing Page
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation elements
  const siteHeader = document.getElementById('header');
  const navToggle = document.getElementById('navToggle');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link, .nav-cta a, .hero-actions a');

  // Sticky header scroll shadow
  const handleScroll = () => {
    if (window.scrollY > 20) {
      siteHeader?.classList.add('scrolled');
    } else {
      siteHeader?.classList.remove('scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // Mobile menu toggle
  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!isExpanded));
      navMenu.classList.toggle('is-open', !isExpanded);
    });
  }

  // Smooth anchor navigation
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (!targetId || targetId === '#') return;

      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();

        // Close mobile menu if open
        if (navMenu && navMenu.classList.contains('is-open')) {
          navMenu.classList.remove('is-open');
          navToggle?.setAttribute('aria-expanded', 'false');
        }

        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });

        // Update URL hash without jump
        if (history.pushState) {
          history.pushState(null, '', targetId);
        } else {
          location.hash = targetId;
        }
      }
    });
  });

  // Drink Category Filtering
  const filterTabs = document.querySelectorAll('.filter-tab');
  const featuredGrid = document.getElementById('featuredGrid');
  const drinkCards = featuredGrid
    ? featuredGrid.querySelectorAll('.drink-card')
    : document.querySelectorAll('.drink-card');

  const activateTab = (tab) => {
    const filter = tab.getAttribute('data-filter') || 'all';

    // Update tab states
    filterTabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    // Filter drink cards
    drinkCards.forEach((card) => {
      const category = card.getAttribute('data-category');
      if (filter === 'all' || category === filter) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  };

  filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      activateTab(tab);
    });

    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        activateTab(tab);
      }
    });
  });

  // Order Summary Badge Counter
  const orderBadge = document.querySelector('#order-summary-badge') || document.querySelector('.order-summary-badge');
  const addToOrderBtns = document.querySelectorAll('.add-to-order-btn');

  let orderCount = 0;
  if (orderBadge) {
    const initialText = orderBadge.textContent.trim();
    const parsed = parseInt(initialText, 10);
    orderCount = isNaN(parsed) ? 0 : parsed;
  }

      addToOrderBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      orderCount += 1;
      const badges = document.querySelectorAll('#order-summary-badge, .order-summary-badge');
      badges.forEach((badge) => {
        badge.textContent = String(orderCount);
        badge.setAttribute('aria-label', `${orderCount} items in order`);
        badge.classList.remove('bump');
        void badge.offsetWidth;
        badge.classList.add('bump');
        badge.addEventListener('animationend', () => {
          badge.classList.remove('bump');
        }, { once: true });
      });
    });
  });

  // ==========================================================================
  // Contact & Inquiry Form Validation and Submission
  // ==========================================================================
  const contactForm = document.getElementById('contact-form');
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const messageInput = document.getElementById('message');
  const successMessage = document.getElementById('contact-success-message');
  const errorBanner = document.getElementById('contact-error-banner');
  const submitBtn = document.getElementById('contact-submit-btn');

  const nameError = document.getElementById('name-error');
  const emailError = document.getElementById('email-error');
  const messageError = document.getElementById('message-error');

  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const showFieldError = (input, errorEl, message) => {
    if (input) {
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
    }
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  };

  const clearFieldError = (input, errorEl) => {
    if (input) {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    }
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
    if (errorBanner) {
      errorBanner.style.display = 'none';
    }
  };

  const validateForm = () => {
    let isValid = true;

    // Validate Name
    const nameVal = nameInput ? nameInput.value.trim() : '';
    if (!nameVal) {
      showFieldError(nameInput, nameError, 'Please enter your name.');
      isValid = false;
    } else {
      clearFieldError(nameInput, nameError);
    }

    // Validate Email
    const emailVal = emailInput ? emailInput.value.trim() : '';
    if (!emailVal) {
      showFieldError(emailInput, emailError, 'Please enter your email address.');
      isValid = false;
    } else if (!isValidEmail(emailVal)) {
      showFieldError(emailInput, emailError, 'Please enter a valid email address.');
      isValid = false;
    } else {
      clearFieldError(emailInput, emailError);
    }

    // Validate Message
    const messageVal = messageInput ? messageInput.value.trim() : '';
    if (!messageVal) {
      showFieldError(messageInput, messageError, 'Please enter your message.');
      isValid = false;
    } else {
      clearFieldError(messageInput, messageError);
    }

    if (!isValid && errorBanner) {
      errorBanner.style.display = 'flex';
    } else if (isValid && errorBanner) {
      errorBanner.style.display = 'none';
    }

    return isValid;
  };

  // Real-time input clearing
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (nameInput.value.trim()) {
        clearFieldError(nameInput, nameError);
      }
    });
  }
  if (emailInput) {
    emailInput.addEventListener('input', () => {
      if (emailInput.value.trim() && isValidEmail(emailInput.value)) {
        clearFieldError(emailInput, emailError);
      }
    });
  }
  if (messageInput) {
    messageInput.addEventListener('input', () => {
      if (messageInput.value.trim()) {
        clearFieldError(messageInput, messageError);
      }
    });
  }

  // Pre-validate on submit button click to display visual errors immediately even if HTML5 prevents submit
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      validateForm();
    });
  }

  // Handle HTML5 invalid events to display visual validation if browser triggers them
  [
    { input: nameInput, errorEl: nameError, msg: 'Please enter your name.' },
    { input: emailInput, errorEl: emailError, msg: 'Please enter a valid email address.' },
    { input: messageInput, errorEl: messageError, msg: 'Please enter your message.' }
  ].forEach(({ input, errorEl, msg }) => {
    if (input) {
      input.addEventListener('invalid', () => {
        showFieldError(input, errorEl, msg);
        if (errorBanner) errorBanner.style.display = 'flex';
      });
    }
  });

  // Handle Form Submission
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const isValid = validateForm();
      if (!isValid) {
        return;
      }

      const nameVal = nameInput ? nameInput.value.trim() : '';
      const emailVal = emailInput ? emailInput.value.trim() : '';
      const messageVal = messageInput ? messageInput.value.trim() : '';

      const inquiry = {
        id: 'inq_' + Date.now(),
        name: nameVal,
        email: emailVal,
        message: messageVal,
        timestamp: new Date().toISOString()
      };

      // Persist to localStorage across standard keys
      const storageKeys = ['recent_messages', 'contact_messages', 'messages', 'coffee_inquiries'];
      storageKeys.forEach((key) => {
        try {
          const raw = localStorage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : [];
          const list = Array.isArray(parsed) ? parsed : [];
          list.push(inquiry);
          localStorage.setItem(key, JSON.stringify(list));
        } catch (err) {
          console.warn(`Could not save message to localStorage under ${key}:`, err);
        }
      });

      // Clear all form inputs
      contactForm.reset();
      if (nameInput) nameInput.value = '';
      if (emailInput) emailInput.value = '';
      if (messageInput) messageInput.value = '';

      // Clear any remaining error styles
      clearFieldError(nameInput, nameError);
      clearFieldError(emailInput, emailError);
      clearFieldError(messageInput, messageError);
      if (errorBanner) errorBanner.style.display = 'none';

      // Show success confirmation
      if (successMessage) {
        successMessage.style.display = 'flex';
        successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
});
