import { randomUUID } from "node:crypto";
import { ACADEMY_CATALOG, getAcademyRoom } from "../../lib/academy/catalog";
import type {
  AcademyCohortJoinArgs,
  AcademyCohortJoinResult,
  AcademyCohortSnapshot,
  AcademyCohortValidationResult,
} from "../../lib/academy/cohortProtocol";
import { runAcademyMissionChecks } from "../../lib/academy/validation";
import { cleanName } from "../../lib/game/filter";

interface CohortParticipantState {
  publicId: string;
  learnerKey: string;
  name: string;
  completedMissionIds: Set<string>;
  connectionIds: Set<string>;
}

interface CohortState {
  roomCode: string;
  trackSlug: string;
  participants: Map<string, CohortParticipantState>;
}

const ROOM_CODE = /^[A-Z2-9]{4,8}$/;
const LEARNER_KEY = /^[A-Za-z0-9-]{8,64}$/;

export function normalizeAcademyRoomCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
}

/**
 * In-memory, transport-agnostic cohort state. Candidate source is accepted by
 * validateMission as a transient parameter, inspected, and immediately
 * discarded. No field in this class can retain learner code or AI prompts.
 */
export class AcademyCohortManager {
  private readonly cohorts = new Map<string, CohortState>();
  private readonly connectionRooms = new Map<string, string>();
  private readonly connectionLearners = new Map<string, string>();

  get roomCount() {
    return this.cohorts.size;
  }

  getRoomCodeForConnection(connectionId: string) {
    return this.connectionRooms.get(connectionId);
  }

  join(connectionId: string, args: AcademyCohortJoinArgs): AcademyCohortJoinResult {
    const roomCode = normalizeAcademyRoomCode(args?.roomCode);
    if (!ROOM_CODE.test(roomCode)) {
      return { ok: false, reason: "Use a 4–8 character room code with letters and digits 2–9." };
    }

    const track = getAcademyRoom(String(args?.trackSlug ?? ""));
    if (!track || track.status !== "playable") {
      return { ok: false, reason: "This academy track is not open for live cohorts." };
    }

    const learnerKey = String(args?.learnerKey ?? "");
    if (!LEARNER_KEY.test(learnerKey)) {
      return { ok: false, reason: "Academy reconnect identity is invalid. Refresh and try again." };
    }

    const existingCode = this.connectionRooms.get(connectionId);
    let cohort = this.cohorts.get(roomCode);
    if (cohort && cohort.trackSlug !== track.slug) {
      return { ok: false, reason: `Room ${roomCode} is already assigned to another technology track.` };
    }

    const existingLearner = this.connectionLearners.get(connectionId);
    if (existingCode && (existingCode !== roomCode || existingLearner !== learnerKey)) {
      this.leave(connectionId);
    }

    cohort = this.cohorts.get(roomCode);
    if (!cohort) {
      cohort = { roomCode, trackSlug: track.slug, participants: new Map() };
      this.cohorts.set(roomCode, cohort);
    }

    const current = cohort.participants.get(learnerKey);
    const participant: CohortParticipantState = current ?? {
      publicId: randomUUID().slice(0, 8),
      learnerKey,
      name: cleanName(args?.name),
      completedMissionIds: new Set(),
      connectionIds: new Set(),
    };
    participant.name = cleanName(args?.name);
    participant.connectionIds.add(connectionId);
    cohort.participants.set(learnerKey, participant);
    this.connectionRooms.set(connectionId, roomCode);
    this.connectionLearners.set(connectionId, learnerKey);
    return { ok: true, snapshot: this.snapshot(roomCode) };
  }

  validateMission(
    connectionId: string,
    missionId: unknown,
    candidateCode: unknown,
  ): AcademyCohortValidationResult {
    const roomCode = this.connectionRooms.get(connectionId);
    const learnerKey = this.connectionLearners.get(connectionId);
    const cohort = roomCode ? this.cohorts.get(roomCode) : undefined;
    const participant = learnerKey ? cohort?.participants.get(learnerKey) : undefined;
    if (!roomCode || !learnerKey || !cohort || !participant) {
      return { ok: false, reason: "Join an academy cohort before publishing progress." };
    }

    const track = getAcademyRoom(cohort.trackSlug);
    const mission = track?.missions.find((item) => item.id === missionId);
    if (!track || !mission) return { ok: false, reason: "Mission does not belong to this room." };

    const code = typeof candidateCode === "string" ? candidateCode : "";
    if (!code || code.length > 24_000) {
      return { ok: false, reason: "Candidate source is missing or too large." };
    }

    const results = runAcademyMissionChecks(mission, code);
    if (!results.every((result) => result.passed)) {
      return { ok: false, reason: "Candidate did not pass every server validation gate.", results };
    }

    const alreadyCompleted = participant.completedMissionIds.has(mission.id);
    participant.completedMissionIds.add(mission.id);
    return {
      ok: true,
      alreadyCompleted,
      results,
      snapshot: this.snapshot(roomCode),
    };
  }

  leave(connectionId: string): { roomCode?: string; snapshot?: AcademyCohortSnapshot } {
    const roomCode = this.connectionRooms.get(connectionId);
    const learnerKey = this.connectionLearners.get(connectionId);
    this.connectionRooms.delete(connectionId);
    this.connectionLearners.delete(connectionId);
    if (!roomCode || !learnerKey) return {};

    const cohort = this.cohorts.get(roomCode);
    if (!cohort) return { roomCode };
    const participant = cohort.participants.get(learnerKey);
    participant?.connectionIds.delete(connectionId);
    if (participant?.connectionIds.size === 0) cohort.participants.delete(learnerKey);
    if (cohort.participants.size === 0) {
      this.cohorts.delete(roomCode);
      return { roomCode };
    }
    return { roomCode, snapshot: this.snapshot(roomCode) };
  }

  /** Detach a socket but preserve its learner briefly for transparent reconnects. */
  disconnect(connectionId: string): {
    roomCode?: string;
    learnerKey?: string;
    snapshot?: AcademyCohortSnapshot;
  } {
    const roomCode = this.connectionRooms.get(connectionId);
    const learnerKey = this.connectionLearners.get(connectionId);
    this.connectionRooms.delete(connectionId);
    this.connectionLearners.delete(connectionId);
    if (!roomCode || !learnerKey) return {};

    const cohort = this.cohorts.get(roomCode);
    const participant = cohort?.participants.get(learnerKey);
    participant?.connectionIds.delete(connectionId);
    return { roomCode, learnerKey, snapshot: this.snapshot(roomCode) };
  }

  /** Remove a disconnected learner only if no socket reclaimed its key. */
  expireDisconnected(roomCode: string, learnerKey: string) {
    const cohort = this.cohorts.get(roomCode);
    const participant = cohort?.participants.get(learnerKey);
    if (!cohort || !participant || participant.connectionIds.size > 0) {
      return { roomCode, snapshot: this.snapshot(roomCode) };
    }

    cohort.participants.delete(learnerKey);
    if (cohort.participants.size === 0) {
      this.cohorts.delete(roomCode);
      return { roomCode };
    }
    return { roomCode, snapshot: this.snapshot(roomCode) };
  }

  snapshot(roomCode: string): AcademyCohortSnapshot | undefined {
    const cohort = this.cohorts.get(roomCode);
    const track = cohort ? getAcademyRoom(cohort.trackSlug) : undefined;
    if (!cohort || !track) return undefined;

    const participants = [...cohort.participants.values()]
      .map((participant) => {
        const completedMissions = track.missions.filter((mission) =>
          participant.completedMissionIds.has(mission.id),
        );
        return {
          id: participant.publicId,
          name: participant.name,
          online: participant.connectionIds.size > 0,
          completedCount: completedMissions.length,
          xp: completedMissions.reduce((sum, mission) => sum + mission.xp, 0),
        };
      })
      .sort((left, right) => right.xp - left.xp || left.name.localeCompare(right.name));

    return {
      roomCode,
      trackSlug: cohort.trackSlug,
      connectedCount: participants.filter((participant) => participant.online).length,
      totalXp: participants.reduce((sum, participant) => sum + participant.xp, 0),
      participants,
      missionProgress: track.missions.map((mission) => ({
        missionId: mission.id,
        completedCount: [...cohort.participants.values()].filter((participant) =>
          participant.completedMissionIds.has(mission.id),
        ).length,
      })),
      updatedAt: Date.now(),
    };
  }

  /** Test-only structural proof that no retained state includes source or prompts. */
  debugSerializableState() {
    return [...this.cohorts.values()].map((cohort) => ({
      roomCode: cohort.roomCode,
      trackSlug: cohort.trackSlug,
      participants: [...cohort.participants.values()].map((participant) => ({
        publicId: participant.publicId,
        learnerKey: participant.learnerKey,
        name: participant.name,
        completedMissionIds: [...participant.completedMissionIds],
        connectionIds: [...participant.connectionIds],
      })),
    }));
  }
}

export const ACADEMY_TRACK_SLUGS = ACADEMY_CATALOG.rooms.map((room) => room.slug);
