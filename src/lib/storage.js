// Tiny localStorage wrapper for the ridden-routes set. Stored as a JSON array.
const KEY = 'cta-bus-bingo:ridden';

export function loadRidden() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

export function saveRidden(set) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...set].sort()));
  } catch {
    // Private-mode Safari and storage-quota errors land here. The toggle still
    // updates in-memory React state; we just can't persist across reloads.
  }
}
