import { ACADEMY_CATALOG } from "../lib/academy/catalog";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(ACADEMY_CATALOG.schemaVersion === 1, "Unsupported academy schema version");
assert(ACADEMY_CATALOG.rooms.length >= 4, "Expected at least four technology rooms");

const roomSlugs = new Set<string>();
let previousOrder = 0;

for (const room of ACADEMY_CATALOG.rooms) {
  assert(!roomSlugs.has(room.slug), `Duplicate academy room slug: ${room.slug}`);
  roomSlugs.add(room.slug);
  assert(/^[a-z0-9-]+$/.test(room.slug), `Unsafe academy room slug: ${room.slug}`);
  assert(room.order > previousOrder, `Room order must increase at ${room.slug}`);
  previousOrder = room.order;
  assert(room.learningOutcomes.length >= 3, `${room.slug} needs at least three outcomes`);
  assert(room.plannedModules.length >= 4, `${room.slug} needs a meaningful syllabus`);

  if (room.status === "playable") {
    assert(room.missions.length > 0, `${room.slug} is playable but has no missions`);
  } else {
    assert(room.missions.length === 0, `${room.slug} previews must not expose partial missions`);
  }

  const missionIds = new Set<string>();
  let previousChapter = 0;
  for (const mission of room.missions) {
    assert(!missionIds.has(mission.id), `Duplicate mission id in ${room.slug}: ${mission.id}`);
    missionIds.add(mission.id);
    assert(mission.chapter > previousChapter, `Mission chapters must increase at ${mission.id}`);
    previousChapter = mission.chapter;
    assert(mission.checks.length >= 3, `${mission.id} needs at least three validation gates`);
    assert(mission.hints.length >= 2, `${mission.id} needs staged teaching hints`);
    assert(mission.starterCode.trim().length > 0, `${mission.id} needs starter code`);
    assert(mission.aiWorkflow.mentorRole.length >= 10, `${mission.id} needs a specific AI mentor role`);
    assert(mission.aiWorkflow.promptTemplate.length >= 200, `${mission.id} needs a production-shaped AI brief`);
    assert(mission.aiWorkflow.reviewQuestions.length >= 3, `${mission.id} needs human review questions`);

    const checkIds = new Set<string>();
    for (const check of mission.checks) {
      assert(!checkIds.has(check.id), `Duplicate check ${check.id} in ${mission.id}`);
      checkIds.add(check.id);
      // Construction catches invalid content at build time instead of in a
      // learner's session. The source remains inert and is never evaluated.
      new RegExp(check.pattern, check.flags);
    }
  }
}

const playableRooms = ACADEMY_CATALOG.rooms.filter((room) => room.status === "playable");
assert(playableRooms.length >= 1, "At least one academy room must be playable");

const missionCount = playableRooms.reduce((total, room) => total + room.missions.length, 0);
console.log(
  `Academy catalog valid: ${ACADEMY_CATALOG.rooms.length} rooms, ${missionCount} playable missions.`,
);
