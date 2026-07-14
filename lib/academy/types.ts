export type AcademyRoomStatus = "playable" | "preview";

export type AcademyMissionDifficulty = "starter" | "intermediate" | "advanced";

/**
 * A deterministic check that can run safely in the browser. We deliberately
 * validate source text instead of evaluating junior developers' code inside
 * the game process. A future sandbox service can implement executable tests
 * without changing the room or mission contracts.
 */
export interface AcademyMissionCheck {
  id: string;
  label: string;
  pattern: string;
  flags?: string;
  failureMessage: string;
}

export interface AcademyAiWorkflow {
  /** The perspective the learner should ask the model to adopt. */
  mentorRole: string;
  /** A production-shaped prompt that the learner can inspect and improve. */
  promptTemplate: string;
  /** Questions the human must answer before accepting generated code. */
  reviewQuestions: string[];
}

export interface AcademyMission {
  id: string;
  chapter: number;
  title: string;
  technology: string;
  difficulty: AcademyMissionDifficulty;
  xp: number;
  estimatedMinutes: number;
  briefing: string;
  objective: string;
  aiWorkflow: AcademyAiWorkflow;
  starterCode: string;
  hints: string[];
  checks: AcademyMissionCheck[];
}

/** One curriculum track maps to one physical room in the Unreal academy. */
export interface AcademyRoom {
  slug: string;
  order: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  status: AcademyRoomStatus;
  accent: string;
  estimatedMinutes: number;
  prerequisites: string[];
  learningOutcomes: string[];
  plannedModules: string[];
  missions: AcademyMission[];
}

export interface AcademyRoomSummary extends Omit<AcademyRoom, "missions"> {
  missionCount: number;
}

export interface AcademyCatalog {
  schemaVersion: 1;
  title: string;
  teaserPath: string;
  rooms: AcademyRoom[];
}
