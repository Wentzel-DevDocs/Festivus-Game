import type { AcademyCheckResult } from "./validation";

export interface AcademyCohortParticipant {
  id: string;
  name: string;
  online: boolean;
  completedCount: number;
  xp: number;
}

export interface AcademyCohortMissionProgress {
  missionId: string;
  completedCount: number;
}

export interface AcademyCohortSnapshot {
  roomCode: string;
  trackSlug: string;
  connectedCount: number;
  totalXp: number;
  participants: AcademyCohortParticipant[];
  missionProgress: AcademyCohortMissionProgress[];
  updatedAt: number;
}

export interface AcademyCohortJoinArgs {
  roomCode: string;
  trackSlug: string;
  name: string;
  /** Local academy reconnect key. Never included in a public snapshot. */
  learnerKey: string;
}

export interface AcademyCohortJoinResult {
  ok: boolean;
  reason?: string;
  snapshot?: AcademyCohortSnapshot;
}

export interface AcademyCohortValidationResult {
  ok: boolean;
  reason?: string;
  alreadyCompleted?: boolean;
  results?: AcademyCheckResult[];
  snapshot?: AcademyCohortSnapshot;
}

export const ACADEMY_COHORT_EVENTS = {
  join: "academy:join",
  validate: "academy:validate",
  snapshot: "academy:snapshot",
} as const;
