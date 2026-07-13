/**
 * Sticky identity — convenience, not an account.
 *
 * On first load we mint a random uuid and park it in localStorage; every
 * later visit (or accidental refresh mid-match) reuses it, so your name and
 * score come right back. Clearing storage or switching devices simply makes
 * you a new person. NOTE: localStorage works in the real deployed app; it
 * only fails inside restricted preview sandboxes — we fall back to a
 * per-tab id there so the game still runs.
 *
 * The sticky id identifies a player's NAME and SCORE only — the server
 * never associates it with a help/hinder side (see server/game/core.ts).
 */

const ID_KEY = "festivus.stickyId";
const NAME_KEY = "festivus.name";
const MUTE_KEY = "festivus.muted";

/** In-memory fallback when localStorage is unavailable. */
let tabId: string | null = null;

/**
 * crypto.randomUUID exists only in SECURE contexts (https / localhost).
 * Phones joining over plain http://<laptop-LAN-ip>:3000 — the documented
 * local-party flow — are an INSECURE context, so fall back to
 * crypto.getRandomValues (available everywhere) shaped into a v4 uuid.
 */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    // A quick write proves storage actually works (private mode quirks).
    window.localStorage.setItem("festivus.probe", "1");
    window.localStorage.removeItem("festivus.probe");
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStickyId(): string {
  const s = storage();
  if (!s) {
    tabId ??= uuid();
    return tabId;
  }
  let id = s.getItem(ID_KEY);
  if (!id) {
    id = uuid();
    s.setItem(ID_KEY, id);
  }
  return id;
}

export function getSavedName(): string {
  return storage()?.getItem(NAME_KEY) ?? "";
}

export function saveName(name: string): void {
  storage()?.setItem(NAME_KEY, name.slice(0, 24));
}

export function getMuted(): boolean {
  return storage()?.getItem(MUTE_KEY) === "1";
}

export function saveMuted(muted: boolean): void {
  storage()?.setItem(MUTE_KEY, muted ? "1" : "0");
}
