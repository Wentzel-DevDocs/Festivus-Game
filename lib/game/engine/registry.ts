/**
 * The event registry — the session runner walks this list in order.
 *
 * ADDING A LEVEL: import your new module and add it to EVENTS. That's the
 * whole registration step (plus a matching PixiJS scene in render/scenes/
 * and, optionally, a tuning row in level_config — see README).
 */

import type { EventModule } from "./types";
import { poleRaise } from "../events/poleRaise";
import { swimSprint } from "../events/swimSprint";
import { greasedClimb } from "../events/greasedClimb";
import { tugOfWar } from "../events/tugOfWar";
import { pinTheBoss } from "../events/pinTheBoss";

/* eslint-disable @typescript-eslint/no-explicit-any -- heterogeneous state types */
export const EVENTS: EventModule<any>[] = [
  poleRaise,
  swimSprint,
  greasedClimb,
  tugOfWar,
  pinTheBoss,
];

export const eventById = new Map(EVENTS.map((e) => [e.id, e]));
