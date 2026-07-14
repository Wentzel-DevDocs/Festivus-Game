import assert from "node:assert/strict";
import { ACADEMY_CATALOG } from "../lib/academy/catalog";
import { AcademyCohortManager } from "../server/academy/cohorts";

const manager = new AcademyCohortManager();
const track = ACADEMY_CATALOG.rooms.find((room) => room.status === "playable");
assert(track, "The academy needs at least one playable technology room.");
const mission = track.missions[0];
assert(mission, "The playable room needs at least one mission.");

const roomCode = "RAID42";
const instructor = manager.join("socket-instructor", {
  roomCode,
  trackSlug: track.slug,
  name: "Grace",
  learnerKey: "learner-grace-001",
});
assert.equal(instructor.ok, true);

const learner = manager.join("socket-learner", {
  roomCode: roomCode.toLowerCase(),
  trackSlug: track.slug,
  name: "Ada",
  learnerKey: "learner-ada-001",
});
assert.equal(learner.ok, true);
assert.equal(learner.snapshot?.connectedCount, 2);

const invalidRoom = manager.join("socket-invalid", {
  roomCode: "A1",
  trackSlug: track.slug,
  name: "Linus",
  learnerKey: "learner-linus-001",
});
assert.equal(invalidRoom.ok, false);

const invalidLearner = manager.join("socket-invalid-learner", {
  roomCode: "VALID2",
  trackSlug: track.slug,
  name: "Linus",
  learnerKey: "bad",
});
assert.equal(invalidLearner.ok, false, "Malformed reconnect identities must fail closed.");

const otherTrack = ACADEMY_CATALOG.rooms.find((room) => room.slug !== track.slug);
assert(otherTrack);
const previewTrack = ACADEMY_CATALOG.rooms.find((room) => room.status !== "playable");
assert(previewTrack);
const previewReservation = manager.join("socket-preview-reservation", {
  roomCode: "LOCK42",
  trackSlug: previewTrack.slug,
  name: "Preview Squatter",
  learnerKey: "learner-preview-001",
});
assert.equal(previewReservation.ok, false, "Preview tracks must not reserve live cohort codes.");
const playableAfterPreview = manager.join("socket-playable-after-preview", {
  roomCode: "LOCK42",
  trackSlug: track.slug,
  name: "Barbara",
  learnerKey: "learner-barbara-001",
});
assert.equal(
  playableAfterPreview.ok,
  true,
  "A rejected preview join must leave the code available to a playable track.",
);
manager.leave("socket-playable-after-preview");

const wrongTrack = manager.join("socket-wrong-track", {
  roomCode,
  trackSlug: otherTrack.slug,
  name: "Margaret",
  learnerKey: "learner-margaret-001",
});
assert.equal(wrongTrack.ok, false, "A room code must be locked to one technology track.");

const switcher = manager.join("socket-switcher", {
  roomCode,
  trackSlug: track.slug,
  name: "Edsger",
  learnerKey: "learner-switcher-001",
});
assert.equal(switcher.ok, true);
assert.equal(switcher.snapshot?.connectedCount, 3);
const switched = manager.join("socket-switcher", {
  roomCode: "NEXT42",
  trackSlug: track.slug,
  name: "Edsger",
  learnerKey: "learner-switcher-001",
});
assert.equal(switched.ok, true);
assert.equal(switched.snapshot?.roomCode, "NEXT42");
assert.equal(
  manager.snapshot(roomCode)?.connectedCount,
  2,
  "Switching rooms must remove the learner from the departed cohort immediately.",
);
manager.leave("socket-switcher");

const incomplete = manager.validateMission("socket-learner", mission.id, mission.starterCode);
assert.equal(incomplete.ok, false, "Starter code must not clear the mission.");

const transientMarker = "TRANSIENT_SECRET_DO_NOT_RETAIN";
const passingCandidate = `"use client";
import { useState } from "react";

export default function DeployCounter() {
  const [count, setCount] = useState(0);
  return (
    <section>
      <output aria-live="polite">{count}</output>
      <button type="button" onClick={() => setCount(current => current + 1)}>
        Record recovery
      </button>
    </section>
  );
}
// ${transientMarker}`;

const validated = manager.validateMission("socket-learner", mission.id, passingCandidate);
assert.equal(validated.ok, true);
assert.equal(validated.snapshot?.connectedCount, 2);
assert.equal(validated.snapshot?.participants.find((participant) => participant.name === "Ada")?.completedCount, 1);
assert.equal(validated.snapshot?.totalXp, mission.xp);

const disconnected = manager.disconnect("socket-learner");
assert.equal(disconnected.snapshot?.connectedCount, 1);
assert.equal(disconnected.snapshot?.participants.find((participant) => participant.name === "Ada")?.online, false);
const reconnected = manager.join("socket-learner-reconnected", {
  roomCode,
  trackSlug: track.slug,
  name: "Ada",
  learnerKey: "learner-ada-001",
});
assert.equal(reconnected.ok, true);
assert.equal(
  reconnected.snapshot?.participants.find((participant) => participant.name === "Ada")?.completedCount,
  1,
  "A reconnect inside the grace window must preserve mission progress.",
);

const retainedState = JSON.stringify(manager.debugSerializableState());
assert.equal(
  retainedState.includes(transientMarker),
  false,
  "Candidate source must be discarded after validation.",
);
assert.equal(/promptDraft|candidateCode|sourceCode/.test(retainedState), false);

const instructorLeave = manager.leave("socket-instructor");
assert.equal(instructorLeave.snapshot?.connectedCount, 1);
manager.leave("socket-learner-reconnected");
assert.equal(manager.roomCount, 0, "Empty cohorts must be deleted.");

console.log(
  `ACADEMY SIMULATION PASSED — ${track.shortTitle}, ${mission.title}, transient source discarded.`,
);
