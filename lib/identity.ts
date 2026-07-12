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
 * never associates it with a help/hinder side (see server/rivet/room.ts).
 */

const ID_KEY = "festivus.stickyId";
const NAME_KEY = "festivus.name";
const MUTE_KEY = "festivus.muted";

/** In-memory fallback when localStorage is unavailable. */
let tabId: string | null = null;

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
    tabId ??= crypto.randomUUID();
    return tabId;
  }
  let id = s.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
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
