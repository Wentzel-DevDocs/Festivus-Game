/**
 * Scene registry: maps a scene key (event id, "jackInTheBox", or
 * "backdrop") to its factory. GameCanvas swaps scenes through this table.
 *
 * ADDING A LEVEL: export a SceneFactory from your new scene file and add
 * it here under your event's id.
 */

import type { SceneFactory } from "../core";
import { backdropScene } from "./backdrop";
import { poleRaiseScene } from "./poleRaise";
import { swimSprintScene } from "./swimSprint";
import { greasedClimbScene } from "./greasedClimb";
import { tugOfWarScene } from "./tugOfWar";
import { pinTheBossScene } from "./pinTheBoss";
import { jackInTheBoxScene } from "./jackInTheBox";

const SCENES: Record<string, SceneFactory> = {
  backdrop: backdropScene,
  poleRaise: poleRaiseScene,
  swimSprint: swimSprintScene,
  greasedClimb: greasedClimbScene,
  tugOfWar: tugOfWarScene,
  pinTheBoss: pinTheBossScene,
  jackInTheBox: jackInTheBoxScene,
};

export function getSceneFactory(key: string): SceneFactory {
  return SCENES[key] ?? SCENES.backdrop;
}
