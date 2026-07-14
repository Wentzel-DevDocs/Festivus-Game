export const UNREAL_ROOM_READY_HASH_PREFIX = "academy-ready-";

const ENTRY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Returns the fragment Unreal should recognize once an embedded academy room
 * is ready to reveal. Normal web visits and malformed/stale entry requests do
 * not participate in the native transition protocol.
 */
export function getUnrealRoomReadyHash(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("unreal") !== "1") return null;

  const entryToken = params.get("entry");
  if (!entryToken || !ENTRY_TOKEN_PATTERN.test(entryToken)) return null;

  return `${UNREAL_ROOM_READY_HASH_PREFIX}${entryToken}`;
}
