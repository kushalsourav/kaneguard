import { fixtureAssets, assetValue, portfolioTotal, usd, parsePrice, safeQuantity } from './math.mjs';
import { icon, hydrateIcons } from '../assets/icons.mjs';
const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get('fixture') || '';
const assets = fixtureAssets(mode);
const quantities = Object.fromEntries(assets.map((asset) => [asset.id, asset.quantity]));
const palette = ['#5a62ef', '#a78bfa', '#23b9aa', '#f4aa56'];
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const STORAGE_KEY = 'coinpulse_watchlist';
const ALERTS_STORAGE_KEY = 'coinpulse_alerts';

function readSavedWatchlist() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('watchlist');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validIds = new Set(assets.map((a) => a.id));
    return parsed
      .map((id) => (typeof id === 'string' || typeof id === 'number' ? String(id).trim().toLowerCase() : ''))
      .filter((id) => validIds.has(id));
  } catch {
    return [];
  }
}

function persistWatchlist() {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized = JSON.stringify([...watchlist]);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem('watchlist', serialized);
  } catch {
    // Graceful fallback for quota or private browsing exceptions
  }
}

function readSavedAlerts() {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY) ?? localStorage.getItem('alerts');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const validIds = new Set(assets.map((a) => a.id));
    const result = {};
    for (const [id, price] of Object.entries(parsed)) {
      const cleanId = String(id).trim().toLowerCase();
      const num = Number(price);
      if (validIds.has(cleanId) && Number.isFinite(num) && num > 0) {
        result[cleanId] = num;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function persistAlerts() {
  if (typeof localStorage === 'undefined') return;
  try {
    const serialized = JSON.stringify(alerts);
    localStorage.setItem(ALERTS_STORAGE_KEY, serialized);
    localStorage.setItem('alerts', serialized);
  } catch {
    // Graceful fallback for quota or private browsing exceptions
  }
}

let filter = 'all';
const watchlist = new Set(readSavedWatchlist());
const alerts = readSavedAlerts();
let currentAlertAssetId = null;

function openAlertDialog(assetId) {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) return;
  currentAlertAssetId = asset.id;
  const nameEl = $('alertCoinName');
  if (nameEl) nameEl.textContent = asset.name;
  const textEl = $('alertCoinNameText');
  if (textEl) textEl.textContent = asset.name;
  const input = $('targetPriceInput');
  if (input) {
    const existing = alerts[asset.id];
    input.value = existing !== undefined ? existing : '';
  }
  const dialog = $('alertDialog');
  if (dialog) {
    dialog.classList.remove('hidden');
  }
  if (input) {
    input.focus();
  }
}

function closeAlertDialog() {
  currentAlertAssetId = null;
  const dialog = $('alertDialog');
  if (dialog) {
    dialog.classList.add('hidden');
  }
  const input = $('targetPriceInput');
  if (input) {
    input.value = '';
  }
}

function saveAlert() {
  if (!currentAlertAssetId) return;
  const input = $('targetPriceInput');
  if (!input) return;
  const raw = input.value.trim();
  const parsed = parseFloat(raw);
  if (!Number.isNaN(parsed) && parsed > 0) {
    alerts[currentAlertAssetId] = parsed;
    persistAlerts();
    closeAlertDialog();
    render();
  }
}
const holdings = () => assets.map((asset, index) => ({ asset, index, value: assetValue(asset, quantities) ?? 0, valid: parsePrice(asset.price) !== null }));

function starSvg(isFav) {
  const fill = isFav ? '#f59e0b' : 'none';
  const stroke = isFav ? '#f59e0b' : '#8894ab';
  return `<svg class="ui-icon star-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}

function updateSummary() {
  const items = holdings();
  const total = portfolioTotal(assets, quantities);
  const ranked = items.slice().sort((a, b) => b.value - a.value);
  const available = items.filter((x) => x.valid).length;
  $('portfolioTotal').textContent = usd(total);
  $('assetCount').textContent = String(assets.length);
  $('ringAssetCount').textContent = String(assets.length);
  $('priceCoverage').textContent = `${available} / ${assets.length}`;
  $('largestAsset').textContent = total > 0 ? ranked[0].asset.symbol : '—';
  $('largestAssetValue').textContent = total > 0 ? `${usd(ranked[0].value)} position` : 'No holdings yet';

  const gradient = [];
  let cursor = 0;
  for (const item of items) {
    const percentage = total > 0 ? (item.value / total) * 100 : 0;
    if (percentage > 0) {
      gradient.push(`${palette[item.index]} ${cursor.toFixed(3)}% ${(cursor + percentage).toFixed(3)}%`);
      cursor += percentage;
    }
  }
  $('allocationRing').style.background = gradient.length ? `conic-gradient(${gradient.join(', ')})` : '#e9edf4';
  $('allocationRing').setAttribute('aria-label', total > 0 ? `Holding allocation: ${items.map(({asset,value}) => `${asset.symbol} ${((value / total) * 100).toFixed(1)} percent`).join(', ')}` : 'Portfolio has zero holdings');
  $('allocationLegend').innerHTML = items.map(({asset,value,index}) => `<div class="legend-row"><span class="legend-label"><i style="--legend-color:${palette[index]}"></i>${escape(asset.symbol)}</span><strong>${total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'}%</strong></div>`).join('');
  const max = Math.max(1, ...items.map((item) => item.value));
  $('allocationBars').innerHTML = items.map(({asset,value,index}) => `<div class="coin-bar-group" title="${escape(asset.name)}: ${escape(usd(value))}"><div class="coin-bar-track"><div class="coin-bar-fill" style="height:${value > 0 ? Math.max(5, value / max * 100) : 0}%;background:${palette[index]}"></div></div><div class="coin-bar-label"><span>${escape(asset.symbol)}</span><small>${total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'}%</small></div></div>`).join('');
  document.querySelectorAll('#assetRows tr[data-asset]').forEach((row) => {
    const asset = assets.find((a) => a.id === row.dataset.asset);
    const value = assetValue(asset, quantities);
    const valueEl = row.querySelector('[data-holding-value]');
    const shareEl = row.querySelector('[data-asset-share]');
    if (valueEl) valueEl.innerHTML = value === null ? '<span class="price-unavailable">Price unavailable</span>' : usd(value);
    if (shareEl) shareEl.textContent = value === null ? '—' : `${total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'}%`;
  });
}
function render() {
  const term = $('assetSearch').value.trim().toLowerCase();
  const sort = $('sortAssets').value;
  let visible = assets.filter((a) => {
    const matchesSearch = `${a.name} ${a.symbol}`.toLowerCase().includes(term);
    if (!matchesSearch) return false;
    if (filter === 'watchlist') return watchlist.has(a.id);
    if (filter === 'gainers') return a.change >= 0;
    if (filter === 'losers') return a.change < 0;
    return true;
  });
  if (sort === 'value-desc') visible.sort((a, b) => (assetValue(b, quantities) ?? -1) - (assetValue(a, quantities) ?? -1));
  else if (sort === 'value-asc') visible.sort((a, b) => (assetValue(a, quantities) ?? Infinity) - (assetValue(b, quantities) ?? Infinity));
  else if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name));
  $('holdingsCount').textContent = String(visible.length).padStart(2, '0');
  $('assetRows').innerHTML = visible.map((asset) => {
    const value = assetValue(asset, quantities);
    const price = parsePrice(asset.price);
    const isFav = watchlist.has(asset.id);
    const alertPrice = alerts[asset.id];
    const hasAlert = alertPrice !== undefined && Number.isFinite(alertPrice) && alertPrice > 0;
    const alertCell = hasAlert
      ? `<div class="alert-display"><span class="alert-target-price" data-alert-price="${escape(alertPrice)}" data-target-price="${escape(alertPrice)}">${usd(alertPrice)}</span><button type="button" class="coin-button secondary remove-alert-btn" data-remove-alert="${escape(asset.id)}" aria-label="Remove alert for ${escape(asset.name)}">Remove Alert</button></div>`
      : `<button type="button" class="coin-button secondary set-alert-btn" data-set-alert="${escape(asset.id)}">Set Alert</button>`;
    return `<tr data-asset="${escape(asset.id)}"><td data-label="Asset"><div class="asset-label"><button type="button" class="star-btn star-toggle ${isFav ? 'active favorited' : ''}" data-star="${escape(asset.id)}" data-favorited="${isFav ? 'true' : 'false'}" data-state="${isFav ? 'active' : 'inactive'}" aria-pressed="${isFav ? 'true' : 'false'}" aria-label="${isFav ? 'Favorited' : 'Favorite'} star for ${escape(asset.name)} (${escape(asset.symbol)})" title="${isFav ? 'Favorited' : 'Favorite'} star for ${escape(asset.name)} (${escape(asset.symbol)})">${starSvg(isFav)}<span class="sr-only">${isFav ? 'Favorited' : 'Favorite'}</span></button><span class="asset-icon ${escape(asset.tint)}">${escape(asset.icon)}</span><span><strong>${escape(asset.name)}</strong><small>${escape(asset.symbol)}</small></span></div></td><td data-label="Reference price" class="coin-price">${price === null ? '<span class="price-unavailable">Price unavailable</span>' : usd(price)}</td><td data-label="Sample 24h"><span class="coin-change ${asset.change >= 0 ? 'change-pos' : 'change-neg'}">${icon(asset.change >= 0 ? 'trending-up' : 'trending-down')}${asset.change >= 0 ? '+' : ''}${asset.change.toFixed(2)}%</span></td><td data-label="Your quantity"><input class="holding-input" aria-label="${escape(asset.symbol)} quantity" type="number" min="0" step="any" inputmode="decimal" data-quantity="${escape(asset.id)}" value="${escape(quantities[asset.id])}" /></td><td data-label="Holding value" class="coin-row-value"><strong data-holding-value>${value === null ? '<span class="price-unavailable">Price unavailable</span>' : usd(value)}</strong></td><td data-label="Allocation"><span class="coin-share" data-asset-share>—</span></td><td data-label="Alert" class="coin-alert-cell">${alertCell}</td></tr>`;
  }).join('');
  $('noResults').classList.toggle('hidden', visible.length > 0);
  updateSummary();
}
$('assetSearch').addEventListener('input', render);
$('sortAssets').addEventListener('change', render);
$('assetRows').addEventListener('click', (event) => {
  const starBtn = event.target.closest('[data-star]');
  if (starBtn) {
    const assetId = starBtn.dataset.star;
    if (watchlist.has(assetId)) {
      watchlist.delete(assetId);
    } else {
      watchlist.add(assetId);
    }
    persistWatchlist();
    render();
    return;
  }
  const removeBtn = event.target.closest('[data-remove-alert]');
  if (removeBtn) {
    const assetId = removeBtn.dataset.removeAlert;
    if (assetId && alerts[assetId] !== undefined) {
      delete alerts[assetId];
      persistAlerts();
      render();
    }
    return;
  }
  const alertBtn = event.target.closest('[data-set-alert]');
  if (alertBtn) {
    const assetId = alertBtn.dataset.setAlert;
    openAlertDialog(assetId);
    return;
  }
});
$('assetRows').addEventListener('change', (event) => {
  const input = event.target.closest('[data-quantity]'); if (!input) return;
  quantities[input.dataset.quantity] = safeQuantity(input.value);
  render();
});
$('assetRows').addEventListener('input', (event) => {
  const input = event.target.closest('[data-quantity]'); if (!input) return;
  quantities[input.dataset.quantity] = safeQuantity(input.value);
  updateSummary();
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => {
    const active = item.dataset.filter === filter;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  render();
}));
$('resetHoldings').addEventListener('click', () => {
  for (const asset of assets) quantities[asset.id] = asset.quantity;
  $('assetSearch').value = ''; $('sortAssets').value = 'default';
  filter = 'all';
  document.querySelectorAll('[data-filter]').forEach((button) => { button.classList.toggle('active', button.dataset.filter === filter); button.setAttribute('aria-pressed', String(button.dataset.filter === filter)); });
  render();
});
$('exportHoldings').addEventListener('click', () => {
  const csv = [['Asset', 'Symbol', 'Reference price', 'Quantity', 'Holding value'], ...assets.map((asset) => [asset.name, asset.symbol, parsePrice(asset.price) ?? 'Unavailable', quantities[asset.id], assetValue(asset, quantities) ?? 'Unavailable'])].map((row) => row.map((item) => `"${String(item).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const file = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'coinpulse-holdings.csv'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const alertForm = $('alertForm');
if (alertForm) {
  alertForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveAlert();
  });
}
const saveBtn = $('saveAlertBtn');
if (saveBtn) {
  saveBtn.addEventListener('click', (event) => {
    event.preventDefault();
    saveAlert();
  });
}
const cancelBtn = $('cancelAlertBtn');
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    closeAlertDialog();
  });
}
const dialogEl = $('alertDialog');
if (dialogEl) {
  dialogEl.addEventListener('click', (event) => {
    if (event.target === dialogEl) {
      closeAlertDialog();
    }
  });
}
document.addEventListener('keydown', (event) => {
  if ((event.key === 'Escape' || event.key === 'Esc') && !$('alertDialog')?.classList.contains('hidden')) {
    closeAlertDialog();
  }
});

hydrateIcons();
render();
