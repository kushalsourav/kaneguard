import { fixtureAssets, assetValue, portfolioTotal, usd, parsePrice, safeQuantity } from './math.mjs';
const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get('fixture') || '';
const assets = fixtureAssets(mode);
const quantities = Object.fromEntries(assets.map((asset) => [asset.id, asset.quantity]));
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function render() {
  const term = $('assetSearch').value.trim().toLowerCase();
  const sort = $('sortAssets').value;
  let visible = assets.filter((a) => `${a.name} ${a.symbol}`.toLowerCase().includes(term));
  if (sort === 'value-desc') visible.sort((a, b) => (assetValue(b, quantities) ?? -1) - (assetValue(a, quantities) ?? -1));
  else if (sort === 'value-asc') visible.sort((a, b) => (assetValue(a, quantities) ?? Infinity) - (assetValue(b, quantities) ?? Infinity));
  else if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name));
  $('assetRows').innerHTML = visible.map((asset) => {
    const value = assetValue(asset, quantities);
    const price = parsePrice(asset.price);
    return `<tr data-asset="${escape(asset.id)}"><td><div class="asset-label"><span class="asset-icon ${escape(asset.tint)}">${escape(asset.icon)}</span><span><strong>${escape(asset.name)}</strong><small>${escape(asset.symbol)}</small></span></div></td><td>${price === null ? '<span class="price-unavailable">Price unavailable</span>' : usd(price)}</td><td class="${asset.change >= 0 ? 'change-pos' : 'change-neg'}">${asset.change >= 0 ? '+' : ''}${asset.change.toFixed(2)}%</td><td><input class="holding-input" aria-label="${escape(asset.symbol)} quantity" type="number" min="0" step="any" data-quantity="${escape(asset.id)}" value="${escape(quantities[asset.id])}" /></td><td><strong>${value === null ? '<span class="price-unavailable">Price unavailable</span>' : usd(value)}</strong></td></tr>`;
  }).join('');
  $('noResults').classList.toggle('hidden', visible.length > 0);
  $('portfolioTotal').textContent = usd(portfolioTotal(assets, quantities));
  $('assetCount').textContent = assets.length;
}
$('assetSearch').addEventListener('input', render);
$('sortAssets').addEventListener('change', render);
$('assetRows').addEventListener('change', (event) => {
  const input = event.target.closest('[data-quantity]'); if (!input) return;
  quantities[input.dataset.quantity] = safeQuantity(input.value);
  render();
});
$('assetRows').addEventListener('input', (event) => {
  const input = event.target.closest('[data-quantity]'); if (!input) return;
  quantities[input.dataset.quantity] = safeQuantity(input.value);
  $('portfolioTotal').textContent = usd(portfolioTotal(assets, quantities));
  const asset = assets.find((item) => item.id === input.dataset.quantity);
  const value = assetValue(asset, quantities);
  input.closest('tr').lastElementChild.innerHTML = `<strong>${value === null ? '<span class="price-unavailable">Price unavailable</span>' : usd(value)}</strong>`;
});
render();
