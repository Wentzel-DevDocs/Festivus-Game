/**
 * The RivetKit registry: the list of actor types this server hosts.
 * The client imports `type { registry }` (types only — no server code
 * reaches the browser bundle) to get fully typed action calls.
 */

import { setup } from "rivetkit";
import { festivusRoom } from "./room";

export const registry = setup({
  use: { festivusRoom },
});

export type Registry = typeof registry;
