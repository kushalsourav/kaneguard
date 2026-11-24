// Counter App - State and DOM Elements
const counterValueEl = document.getElementById('counter-value');
const increaseBtn = document.getElementById('increase-btn');
const decreaseBtn = document.getElementById('decrease-btn');
const resetBtn = document.getElementById('reset-btn');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconEl = themeToggleBtn ? themeToggleBtn.querySelector('.theme-icon') : null;

/**
 * Validate and parse saved count string.
 * Returns non-negative integer or null if invalid.
 */
function parseCountValue(val) {
  if (val !== null && val !== undefined && typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * Load valid counter value from localStorage on startup, defaulting to 0.
 */
function loadSavedCount() {
  try {
    const savedCounter = parseCountValue(localStorage.getItem('counter'));
    if (savedCounter !== null) {
      return savedCounter;
    }
    const savedCount = parseCountValue(localStorage.getItem('count'));
    if (savedCount !== null) {
      return savedCount;
    }
  } catch (e) {
    console.error('Failed to load counter from localStorage:', e);
  }
  return 0;
}

/**
 * Persist counter value to localStorage.
 */
function saveCount() {
  try {
    localStorage.setItem('counter', count.toString());
    localStorage.setItem('count', count.toString());
  } catch (e) {
    console.error('Failed to save counter to localStorage:', e);
  }
}

let count = loadSavedCount();

// Render counter value to the DOM
function render() {
  if (counterValueEl) {
    counterValueEl.textContent = count.toString();
    counterValueEl.setAttribute('data-count', count.toString());
  }
}

// Bounded counter controls: increase by 1, decrease by 1 (minimum 0), reset to 0
function increase() {
  count += 1;
  saveCount();
  render();
}

function decrease() {
  if (count > 0) {
    count -= 1;
    saveCount();
    render();
  }
}

function reset() {
  count = 0;
  saveCount();
  render();
}

if (increaseBtn) {
  increaseBtn.addEventListener('click', increase);
}

if (decreaseBtn) {
  decreaseBtn.addEventListener('click', decrease);
}

if (resetBtn) {
  resetBtn.addEventListener('click', reset);
}

// Theme handling
const THEME_STORAGE_KEYS = ['theme', 'color-theme', 'theme-mode'];

/**
 * Validate and parse saved theme string.
 * Returns 'dark', 'light', or null.
 */
function parseThemeValue(val) {
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    if (normalized === 'dark' || normalized === 'dark-theme' || normalized === 'dark-mode') {
      return 'dark';
    }
    if (normalized === 'light' || normalized === 'light-theme' || normalized === 'light-mode') {
      return 'light';
    }
  }
  return null;
}

/**
 * Load saved theme from localStorage.
 */
function loadSavedTheme() {
  try {
    for (const key of THEME_STORAGE_KEYS) {
      const parsed = parseThemeValue(localStorage.getItem(key));
      if (parsed) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load theme from localStorage:', e);
  }
  return null;
}

/**
 * Persist theme to localStorage.
 */
function saveTheme(theme) {
  try {
    for (const key of THEME_STORAGE_KEYS) {
      localStorage.setItem(key, theme);
    }
  } catch (e) {
    console.error('Failed to save theme to localStorage:', e);
  }
}

/**
 * Apply theme to document elements and update control state.
 */
function applyTheme(theme, shouldSave = false) {
  const isDark = theme === 'dark';

  // Apply to documentElement (HTML tag)
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('dark-theme', isDark);
  document.documentElement.classList.toggle('dark-mode', isDark);
  document.documentElement.classList.toggle('light', !isDark);
  document.documentElement.classList.toggle('light-theme', !isDark);
  document.documentElement.classList.toggle('light-mode', !isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

  // Apply to body tag
  if (document.body) {
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.body.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark-theme', isDark);
    document.body.classList.toggle('dark-mode', isDark);
    document.body.classList.toggle('light', !isDark);
    document.body.classList.toggle('light-theme', !isDark);
    document.body.classList.toggle('light-mode', !isDark);
  }

  // Update theme toggle button control state
  if (themeToggleBtn) {
    themeToggleBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    themeToggleBtn.setAttribute('data-theme', isDark ? 'dark' : 'light');
    themeToggleBtn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  }

  // Update icon indicator
  if (themeIconEl) {
    themeIconEl.textContent = isDark ? '☀️' : '🌓';
  }

  // Persist if triggered by user action
  if (shouldSave) {
    saveTheme(isDark ? 'dark' : 'light');
  }
}

/**
 * Toggle between light and dark themes and persist.
 */
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') ||
    (document.body && document.body.classList.contains('dark') ? 'dark' : 'light');
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme, true);
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', toggleTheme);
}

// Initialize theme: restore saved theme or default to light
const initialTheme = loadSavedTheme() || 'light';
applyTheme(initialTheme, false);

// Initial render with loaded or default count
render();
