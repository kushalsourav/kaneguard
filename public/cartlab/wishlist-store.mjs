const STORAGE_KEY = 'cartlab_wishlist';

function readList() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list = [];
    for (const item of parsed) {
      if (typeof item === 'string' || typeof item === 'number') {
        const id = String(item).trim();
        if (id && !list.includes(id)) {
          list.push(id);
        }
      }
    }
    return list;
  } catch {
    return [];
  }
}

function writeList(list) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Gracefully handle storage errors (e.g. quota, private browsing restriction)
  }
}

export function getWishlist() {
  return readList();
}

export function addToWishlist(productId) {
  if (productId == null) return getWishlist();
  const id = String(productId).trim();
  if (!id) return getWishlist();
  const list = readList();
  if (!list.includes(id)) {
    list.push(id);
    writeList(list);
  }
  return list;
}

export function removeFromWishlist(productId) {
  if (productId == null) return getWishlist();
  const id = String(productId).trim();
  const list = readList().filter((item) => item !== id);
  writeList(list);
  return list;
}

export function isInWishlist(productId) {
  if (productId == null) return false;
  const id = String(productId).trim();
  if (!id) return false;
  return getWishlist().includes(id);
}

export function toggleWishlist(productId) {
  if (isInWishlist(productId)) {
    return removeFromWishlist(productId);
  }
  return addToWishlist(productId);
}
