// Lightweight per-browser identity for notes — no real auth. A typed name,
// stable across reloads via localStorage. Not a security boundary.

const STORAGE_KEY = 'discord-dashboard-identity';

export interface LocalIdentity {
  id: string;
  name: string;
}

export function getLocalIdentity(): LocalIdentity {
  if (typeof window === 'undefined') return { id: '', name: '' };

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as LocalIdentity;
      if (parsed.id && parsed.name) return parsed;
    } catch {
      // fall through and re-create
    }
  }

  const identity: LocalIdentity = { id: crypto.randomUUID(), name: '' };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function setLocalName(name: string): LocalIdentity {
  const identity = { ...getLocalIdentity(), name };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}
