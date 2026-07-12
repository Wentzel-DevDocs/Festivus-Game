/**
 * A small, dependency-free profanity mask for grievances.
 *
 * Philosophy: this is a work party, not a courtroom. We MASK rather than
 * reject (rejecting invites "why was mine eaten?" questions that break the
 * anonymous vibe), and the host's Hide button on the boss view is the
 * real moderation tool for anything the list misses.
 *
 * Extend WORDS with anything your office needs. Matching is
 * case-insensitive, tolerates repeated letters ("heeeck") and common
 * symbol swaps (@ for a, 0 for o, etc.).
 */

const WORDS = [
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "asshole",
  "bastard",
  "dick",
  "piss",
  "slut",
  "whore",
  "fag",
  "nigger",
  "nigga",
  "retard",
];

/** Map of symbol/leet substitutions we normalize before matching. */
const LEET: Record<string, string> = {
  "@": "a",
  "4": "a",
  "3": "e",
  "1": "i",
  "!": "i",
  "0": "o",
  "$": "s",
  "5": "s",
  "7": "t",
};

/** Build one regex per word that tolerates letter repeats: f+u+c+k+ */
const PATTERNS = WORDS.map(
  (w) => new RegExp(`\\b${w.split("").map((ch) => `${ch}+`).join("")}\\b`, "gi"),
);

function normalizeLeet(text: string): string {
  return text.replace(/[@431!0$57]/g, (ch) => LEET[ch] ?? ch);
}

/**
 * Mask profanity: keeps the first letter, stars the rest ("f***").
 * Works on the leet-normalized text, then maps masks back by position
 * (normalization is 1:1 per character, so indexes line up).
 */
export function maskProfanity(text: string): string {
  const normalized = normalizeLeet(text.toLowerCase());
  const out = text.split("");
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(normalized)) !== null) {
      for (let i = m.index + 1; i < m.index + m[0].length; i++) out[i] = "*";
    }
  }
  return out.join("");
}

/** Grievance sanitation: trim, collapse whitespace, clamp length, mask. */
export function cleanGrievance(text: string, maxLen: number): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, maxLen);
  if (!trimmed) return null;
  return maskProfanity(trimmed);
}

/** Display-name sanitation: strip control chars, clamp, fallback. */
export function cleanName(name: unknown): string {
  const s = String(name ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return maskProfanity(s) || `Cousin ${Math.floor(Math.random() * 900 + 100)}`;
}
