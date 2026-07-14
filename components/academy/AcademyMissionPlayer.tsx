"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AcademyMission, AcademyRoom } from "@/lib/academy/types";
import {
  ACADEMY_LEARNER_KEY_STORAGE,
  getAcademyLearnerKey,
  useAcademyCohort,
} from "@/lib/academy/useAcademyCohort";
import {
  runAcademyMissionChecks,
  type AcademyCheckResult,
} from "@/lib/academy/validation";
import {
  getUnrealRoomReadyHash,
  UNREAL_ROOM_READY_HASH_PREFIX,
} from "@/lib/academy/unrealBridge";
import { getSavedName, saveName } from "@/lib/identity";

interface StoredProgress {
  completed: string[];
  drafts: Record<string, string>;
  prompts: Record<string, string>;
}

interface MentorReply {
  mode: "live" | "offline";
  summary: string;
  nextPrompt: string;
  risks: string[];
  reviewChecklist: string[];
  model?: string;
}

interface MentorRequest {
  controller: AbortController;
  missionId: string;
  code: string;
  promptDraft: string;
}

const ACADEMY_PROGRESS_PREFIX = "festivus-academy:";
const volatileProgress = new Map<string, StoredProgress>();

function emptyProgress(): StoredProgress {
  return { completed: [], drafts: {}, prompts: {} };
}

function progressKey(roomSlug: string, learnerKey: string) {
  return `${ACADEMY_PROGRESS_PREFIX}${roomSlug}:${learnerKey}:progress:v2`;
}

function legacyProgressKey(roomSlug: string) {
  return `${ACADEMY_PROGRESS_PREFIX}${roomSlug}:progress:v1`;
}

function parseProgress(value: string | null): StoredProgress {
  try {
    if (!value) return emptyProgress();
    const parsed = JSON.parse(value) as Partial<StoredProgress>;
    const stringRecord = (candidate: unknown) =>
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? Object.fromEntries(
            Object.entries(candidate).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    return {
      completed: Array.isArray(parsed.completed)
        ? parsed.completed.filter((id): id is string => typeof id === "string")
        : [],
      drafts: stringRecord(parsed.drafts),
      prompts: stringRecord(parsed.prompts),
    };
  } catch {
    return emptyProgress();
  }
}

function readProgress(roomSlug: string, learnerKey: string): StoredProgress {
  const key = progressKey(roomSlug, learnerKey);
  try {
    const scoped = window.localStorage.getItem(key);
    if (scoped) return parseProgress(scoped);

    // Preserve the current learner's pre-v2 work once, then remove the
    // room-wide key so a later learner can never inherit it.
    const legacyKey = legacyProgressKey(roomSlug);
    const legacy = window.localStorage.getItem(legacyKey);
    if (!legacy) return volatileProgress.get(key) ?? emptyProgress();
    const migrated = parseProgress(legacy);
    window.localStorage.setItem(key, JSON.stringify(migrated));
    window.localStorage.removeItem(legacyKey);
    return migrated;
  } catch {
    return volatileProgress.get(key) ?? emptyProgress();
  }
}

function updateProgress(
  roomSlug: string,
  learnerKey: string,
  update: (latest: StoredProgress) => StoredProgress,
) {
  const latest = readProgress(roomSlug, learnerKey);
  const next = update(latest);
  const key = progressKey(roomSlug, learnerKey);
  volatileProgress.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Sandboxed web views may deny localStorage. React state still preserves
    // the work for the life of the current room visit.
  }
  return next;
}

function clearAllAcademyProgress() {
  volatileProgress.clear();
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    ).filter((key): key is string => Boolean(key?.startsWith(ACADEMY_PROGRESS_PREFIX)));
    for (const key of keys) {
      if (key.includes(":progress:v")) window.localStorage.removeItem(key);
    }
  } catch {
    // There is nothing durable to clear when storage is unavailable.
  }
}

function missionNumber(mission: AcademyMission) {
  return String(mission.chapter).padStart(2, "0");
}

export default function AcademyMissionPlayer({ room }: { room: AcademyRoom }) {
  const cohort = useAcademyCohort(room.slug);
  const [activeIndex, setActiveIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [code, setCode] = useState(room.missions[0]?.starterCode ?? "");
  const [promptDraft, setPromptDraft] = useState(
    room.missions[0]?.aiWorkflow.promptTemplate ?? "",
  );
  const [results, setResults] = useState<AcademyCheckResult[]>([]);
  const [hintCount, setHintCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [mentorReply, setMentorReply] = useState<MentorReply | null>(null);
  const [mentorError, setMentorError] = useState("");
  const [mentorLoading, setMentorLoading] = useState(false);
  const [cohortName, setCohortName] = useState("");
  const [cohortCode, setCohortCode] = useState("");
  const [cohortError, setCohortError] = useState("");
  const [cohortPublishing, setCohortPublishing] = useState(false);
  const [learnerKey, setLearnerKey] = useState("");
  const mentorRequestRef = useRef<MentorRequest | null>(null);

  const activeMission = room.missions[activeIndex];
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const firstIncomplete = room.missions.findIndex(
    (mission) => !completedSet.has(mission.id),
  );
  const maxUnlockedIndex =
    firstIncomplete === -1 ? room.missions.length - 1 : firstIncomplete;
  const earnedXp = room.missions.reduce(
    (total, mission) => total + (completedSet.has(mission.id) ? mission.xp : 0),
    0,
  );
  const totalXp = room.missions.reduce((total, mission) => total + mission.xp, 0);

  useEffect(() => {
    mentorRequestRef.current?.controller.abort();
    mentorRequestRef.current = null;
    const currentLearnerKey = getAcademyLearnerKey();
    const saved = readProgress(room.slug, currentLearnerKey);
    const savedSet = new Set(saved.completed);
    const nextIndex = room.missions.findIndex((mission) => !savedSet.has(mission.id));
    const initialIndex = nextIndex === -1 ? Math.max(0, room.missions.length - 1) : nextIndex;
    const mission = room.missions[initialIndex];

    setLearnerKey(currentLearnerKey);
    setCompleted(saved.completed);
    setDrafts(saved.drafts);
    setPromptDrafts(saved.prompts);
    setActiveIndex(initialIndex);
    setCode(saved.drafts[mission.id] ?? mission.starterCode);
    setPromptDraft(saved.prompts[mission.id] ?? mission.aiWorkflow.promptTemplate);
    setResults([]);
    setHintCount(0);
    setMentorLoading(false);
    setMentorReply(null);
    setMentorError("");
    setHydrated(true);
  }, [room]);

  useEffect(() => {
    if (!learnerKey) return;
    const key = progressKey(room.slug, learnerKey);

    const syncProgress = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;

      if (event.key === ACADEMY_LEARNER_KEY_STORAGE) {
        const nextLearnerKey = getAcademyLearnerKey();
        if (nextLearnerKey === learnerKey) return;

        // A sibling tab started a new learner. Release every piece of the old
        // learner's visible work immediately; useAcademyCohort independently
        // detaches its old live cohort connection on the same storage event.
        try {
          window.localStorage.removeItem(key);
        } catch {
          // Storage may become unavailable after the event was delivered.
        }
        volatileProgress.delete(key);
        const saved = readProgress(room.slug, nextLearnerKey);
        const savedSet = new Set(saved.completed);
        const nextIndex = room.missions.findIndex((mission) => !savedSet.has(mission.id));
        const initialIndex =
          nextIndex === -1 ? Math.max(0, room.missions.length - 1) : nextIndex;
        const mission = room.missions[initialIndex];

        mentorRequestRef.current?.controller.abort();
        mentorRequestRef.current = null;
        setLearnerKey(nextLearnerKey);
        setCompleted(saved.completed);
        setDrafts(saved.drafts);
        setPromptDrafts(saved.prompts);
        setActiveIndex(initialIndex);
        setCode(saved.drafts[mission.id] ?? mission.starterCode);
        setPromptDraft(saved.prompts[mission.id] ?? mission.aiWorkflow.promptTemplate);
        setResults([]);
        setHintCount(0);
        setMentorLoading(false);
        setMentorReply(null);
        setMentorError("");
        setCohortError("");
        setCohortCode("");
        return;
      }

      if (event.key !== key) return;
      const saved = parseProgress(event.newValue);
      const mission = room.missions[activeIndex];
      if (!mission) return;

      setCompleted(saved.completed);
      setDrafts(saved.drafts);
      setPromptDrafts(saved.prompts);
      setCode(saved.drafts[mission.id] ?? mission.starterCode);
      setPromptDraft(saved.prompts[mission.id] ?? mission.aiWorkflow.promptTemplate);
      setResults([]);
      mentorRequestRef.current?.controller.abort();
      mentorRequestRef.current = null;
      setMentorLoading(false);
      setMentorReply(null);
      setMentorError("");
    };

    window.addEventListener("storage", syncProgress);
    return () => window.removeEventListener("storage", syncProgress);
  }, [activeIndex, learnerKey, room]);

  useEffect(
    () => () => {
      mentorRequestRef.current?.controller.abort();
      mentorRequestRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!hydrated) return;

    const parsedReadyHash = getUnrealRoomReadyHash(window.location.search);
    if (!parsedReadyHash) return;
    const readyHash: string = parsedReadyHash;
    const entryToken = readyHash.slice(UNREAL_ROOM_READY_HASH_PREFIX.length);

    let cancelled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    let bridgeTimer = 0;

    document.documentElement.dataset.unrealAcademy = "1";

    function signalNativeBridge(attempt = 0) {
      if (cancelled) return;
      const unrealWindow = window as Window & {
        ue?: {
          academybridge?: {
            ready?: (token: string) => Promise<unknown> | unknown;
          };
        };
      };
      const bridge = unrealWindow.ue?.academybridge;
      if (typeof bridge?.ready === "function") {
        void Promise.resolve(bridge.ready(entryToken)).catch(() => {
          // The URL hash and native timeout remain recovery paths.
        });
        return;
      }
      if (attempt < 160) {
        bridgeTimer = window.setTimeout(() => signalNativeBridge(attempt + 1), 50);
      }
    }

    async function signalReadyAfterPaint() {
      // Let the embedded page settle its type and the restored mission state,
      // then wait through two actual paints before asking Unreal to reveal it.
      // The hash is a CEF-compatible fallback; UE's narrow UObject bridge is
      // the authoritative callback on macOS WKWebView.
      try {
        await document.fonts?.ready;
      } catch {
        // Font loading failure must not strand the native transition cover.
      }
      if (cancelled) return;

      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (!cancelled && window.location.hash !== `#${readyHash}`) {
            window.location.hash = readyHash;
          }
          signalNativeBridge();
        });
      });
    }

    void signalReadyAfterPaint();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(bridgeTimer);
      delete document.documentElement.dataset.unrealAcademy;
    };
  }, [hydrated, room.slug]);

  useEffect(() => {
    setCohortName(getSavedName());
    const fromUrl = new URLSearchParams(window.location.search).get("cohort");
    if (fromUrl) setCohortCode(fromUrl.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8));
  }, []);

  if (!activeMission) {
    return <p className="text-aluminum-300">This room has no missions yet.</p>;
  }

  function cancelMentorRequest() {
    mentorRequestRef.current?.controller.abort();
    mentorRequestRef.current = null;
    setMentorLoading(false);
    setMentorReply(null);
    setMentorError("");
  }

  function adoptPersistedProgress(next: StoredProgress) {
    setCompleted(next.completed);
    setDrafts(next.drafts);
    setPromptDrafts(next.prompts);
  }

  function selectMission(index: number) {
    if (index > maxUnlockedIndex) return;
    const mission = room.missions[index];
    cancelMentorRequest();
    setActiveIndex(index);
    setCode(drafts[mission.id] ?? mission.starterCode);
    setPromptDraft(promptDrafts[mission.id] ?? mission.aiWorkflow.promptTemplate);
    setResults([]);
    setHintCount(0);
    setMentorReply(null);
    setMentorError("");
  }

  function updateCode(nextCode: string) {
    cancelMentorRequest();
    setResults([]);
    setCode(nextCode);
    if (!learnerKey) return;
    const next = updateProgress(room.slug, learnerKey, (latest) => ({
      ...latest,
      drafts: { ...latest.drafts, [activeMission.id]: nextCode },
    }));
    adoptPersistedProgress(next);
  }

  function updatePromptDraft(nextPrompt: string) {
    cancelMentorRequest();
    setPromptDraft(nextPrompt);
    if (!learnerKey) return;
    const next = updateProgress(room.slug, learnerKey, (latest) => ({
      ...latest,
      prompts: { ...latest.prompts, [activeMission.id]: nextPrompt },
    }));
    adoptPersistedProgress(next);
  }

  function generateCohortCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const values = crypto.getRandomValues(new Uint8Array(6));
    setCohortCode([...values].map((value) => alphabet[value % alphabet.length]).join(""));
    setCohortError("");
  }

  async function joinCohort() {
    const cleanCode = cohortCode.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8);
    const cleanName = cohortName.trim();
    if (!cleanCode || !cleanName) {
      setCohortError("Enter a name and a 4–8 character cohort code.");
      return;
    }
    setCohortError("");
    saveName(cleanName);
    const result = await cohort.join(cleanCode, cleanName);
    if (!result.ok) setCohortError(result.reason ?? "Could not join cohort.");
  }

  async function askMentor() {
    mentorRequestRef.current?.controller.abort();
    const request: MentorRequest = {
      controller: new AbortController(),
      missionId: activeMission.id,
      code,
      promptDraft,
    };
    mentorRequestRef.current = request;
    setMentorLoading(true);
    setMentorError("");
    setMentorReply(null);
    try {
      const response = await fetch("/api/academy/mentor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomSlug: room.slug,
          missionId: activeMission.id,
          promptDraft,
          code,
        }),
        signal: request.controller.signal,
      });
      const payload = (await response.json()) as MentorReply | { error?: string };
      if (!response.ok || !("summary" in payload)) {
        throw new Error("error" in payload && payload.error ? payload.error : "Mentor request failed");
      }
      if (mentorRequestRef.current !== request) return;
      setMentorReply(payload);
    } catch (error) {
      if (mentorRequestRef.current !== request || request.controller.signal.aborted) return;
      setMentorError(error instanceof Error ? error.message : "Mentor request failed");
    } finally {
      if (mentorRequestRef.current === request) {
        mentorRequestRef.current = null;
        setMentorLoading(false);
      }
    }
  }

  async function runChecks() {
    const nextResults = runAcademyMissionChecks(activeMission, code);

    setResults(nextResults);
    if (nextResults.every((result) => result.passed)) {
      if (cohort.joined && cohort.status === "connected") {
        setCohortPublishing(true);
        const cohortResult = await cohort.validateMission(activeMission.id, code);
        setCohortPublishing(false);
        if (!cohortResult.ok) {
          setCohortError(cohortResult.reason ?? "The cohort server refused this result.");
          if (cohortResult.results) setResults(cohortResult.results);
          return;
        }
        setCohortError("");
      } else if (cohort.joined) {
        setCohortError("Cohort server is offline. This completion is saved on this device only.");
      }
      if (!learnerKey) return;
      const next = updateProgress(room.slug, learnerKey, (latest) => ({
        ...latest,
        completed: latest.completed.includes(activeMission.id)
          ? latest.completed
          : [...latest.completed, activeMission.id],
      }));
      adoptPersistedProgress(next);
    }
  }

  function resetMission() {
    cancelMentorRequest();
    setCode(activeMission.starterCode);
    setResults([]);
    setHintCount(0);
    if (!learnerKey) return;
    const next = updateProgress(room.slug, learnerKey, (latest) => {
      const nextDrafts = { ...latest.drafts };
      delete nextDrafts[activeMission.id];
      return { ...latest, drafts: nextDrafts };
    });
    adoptPersistedProgress(next);
  }

  function startNewLearner() {
    if (
      !window.confirm(
        "Start a new learner? This clears every locally saved Academy draft, AI brief, and completion on this device.",
      )
    ) {
      return;
    }

    cancelMentorRequest();
    clearAllAcademyProgress();
    const nextLearnerKey = cohort.startNewLearner();
    setLearnerKey(nextLearnerKey);
    setActiveIndex(0);
    setCompleted([]);
    setDrafts({});
    setPromptDrafts({});
    setCode(room.missions[0]?.starterCode ?? "");
    setPromptDraft(room.missions[0]?.aiWorkflow.promptTemplate ?? "");
    setResults([]);
    setHintCount(0);
    setCohortError("");
    setCohortCode("");
  }

  const passed =
    completedSet.has(activeMission.id) ||
    (results.length > 0 && results.every((result) => result.passed));

  return (
    <section
      className="academy-mission-shell"
      data-academy-hydrated={hydrated ? "true" : "false"}
      aria-label={`${room.title} missions`}
    >
      <aside className="academy-mission-rail forge-panel" aria-label="Mission map">
        <div className="p-4 md:p-5">
          <p className="eyebrow">Room progress</p>
          <div className="mt-2 flex items-end justify-between gap-3">
            <strong className="display-header text-2xl text-aluminum-100">
              {completed.length}/{room.missions.length}
            </strong>
            <span className="font-mono text-xs text-grease">
              {earnedXp}/{totalXp} XP
            </span>
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-aluminum-950"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={room.missions.length}
            aria-valuenow={completed.length}
            aria-label="Completed missions"
          >
            <div
              className="h-full rounded-full bg-support transition-[width] duration-500"
              style={{ width: `${(completed.length / room.missions.length) * 100}%` }}
            />
          </div>
          <button
            type="button"
            onClick={startNewLearner}
            disabled={cohortPublishing}
            className="mt-4 min-h-11 w-full rounded-md border border-aluminum-600 px-3 font-mono text-[0.65rem] uppercase tracking-wider text-aluminum-400 hover:border-grease hover:text-grease disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start new learner
          </button>
        </div>

        <nav className="border-t border-aluminum-700/70 p-2" aria-label="Room missions">
          {room.missions.map((mission, index) => {
            const isComplete = completedSet.has(mission.id);
            const isLocked = hydrated && index > maxUnlockedIndex;
            const isActive = index === activeIndex;
            return (
              <button
                key={mission.id}
                type="button"
                disabled={isLocked}
                aria-current={isActive ? "step" : undefined}
                onClick={() => selectMission(index)}
                className={`academy-mission-nav ${isActive ? "is-active" : ""} ${isComplete ? "is-complete" : ""}`}
              >
                <span className="font-mono text-xs" aria-hidden="true">
                  {isComplete ? "✓" : isLocked ? "◇" : missionNumber(mission)}
                </span>
                <span>
                  <strong>{mission.title}</strong>
                  <small>{mission.technology} · {mission.xp} XP</small>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="academy-workbench forge-panel">
        <header className="border-b border-aluminum-700/70 p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-chip">Mission {missionNumber(activeMission)}</span>
            <span className="hud-chip">{activeMission.technology}</span>
            <span className="hud-chip">{activeMission.difficulty}</span>
            <span className="hud-chip">~{activeMission.estimatedMinutes} min</span>
          </div>
          <h2 className="display-header mt-4 text-2xl text-aluminum-100 md:text-4xl">
            {activeMission.title}
          </h2>
          <p className="mt-3 max-w-4xl leading-7 text-aluminum-300">
            {activeMission.briefing}
          </p>
          <div className="mt-4 rounded-lg border border-grease/30 bg-grease/5 p-4">
            <p className="eyebrow">Objective</p>
            <p className="mt-2 text-sm leading-6 text-aluminum-200">
              {activeMission.objective}
            </p>
          </div>
        </header>

        <div className="academy-code-grid">
          <div className="min-w-0">
            <div className="flex items-center justify-between border-b border-aluminum-700 bg-aluminum-950/80 px-4 py-3">
              <span className="font-mono text-xs uppercase tracking-widest text-aluminum-400">
                mission.tsx
              </span>
              <button
                type="button"
                onClick={resetMission}
                className="min-h-11 rounded-md border border-aluminum-600 px-3 font-mono text-xs uppercase text-aluminum-300 hover:border-grease hover:text-grease"
              >
                Reset
              </button>
            </div>
            <label htmlFor="academy-editor" className="sr-only">
              Code editor for {activeMission.title}
            </label>
            <textarea
              id="academy-editor"
              value={code}
              onChange={(event) => updateCode(event.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="academy-code-editor"
            />
          </div>

          <aside className="academy-test-panel" aria-label="Mission checks and hints">
            <div className="academy-cohort-panel">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Live cohort</p>
                  <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-wider text-aluminum-500">
                    One technology · one room code
                  </p>
                </div>
                <span className={`academy-connection ${cohort.status}`}>
                  {cohort.status}
                </span>
              </div>

              {!cohort.joined ? (
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="font-mono text-[0.62rem] uppercase tracking-widest text-aluminum-400">
                      Developer name
                    </span>
                    <input
                      value={cohortName}
                      onChange={(event) => setCohortName(event.target.value)}
                      maxLength={24}
                      className="academy-cohort-input"
                      placeholder="e.g. Ada"
                    />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[0.62rem] uppercase tracking-widest text-aluminum-400">
                      Cohort code
                    </span>
                    <input
                      value={cohortCode}
                      onChange={(event) =>
                        setCohortCode(
                          event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 8),
                        )
                      }
                      minLength={4}
                      maxLength={8}
                      className="academy-cohort-input font-mono uppercase tracking-[0.2em]"
                      placeholder="RAID42"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={generateCohortCode}
                      className="min-h-11 rounded-md border border-aluminum-600 px-2 text-xs text-aluminum-300 hover:border-grease hover:text-grease"
                    >
                      Generate code
                    </button>
                    <button
                      type="button"
                      onClick={joinCohort}
                      disabled={cohort.status !== "connected"}
                      className="min-h-11 rounded-md bg-support px-2 text-xs font-semibold text-aluminum-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Join cohort
                    </button>
                  </div>
                  <p className="text-[0.68rem] leading-5 text-aluminum-500">
                    Candidate code is validated transiently by the room server and
                    immediately discarded. Only names, mission completion, and XP are retained in memory.
                  </p>
                </div>
              ) : cohort.snapshot ? (
                <div className="mt-4">
                  <div className="flex items-end justify-between gap-3 rounded-lg border border-support/30 bg-support/5 p-3">
                    <div>
                      <span className="font-mono text-[0.6rem] uppercase tracking-widest text-aluminum-500">
                        Room code
                      </span>
                      <strong className="mt-1 block font-mono text-xl tracking-[0.18em] text-support">
                        {cohort.snapshot.roomCode}
                      </strong>
                    </div>
                    <div className="text-right font-mono text-xs text-aluminum-400">
                      <span className="block">{cohort.snapshot.connectedCount} online</span>
                      <span className="mt-1 block text-grease">{cohort.snapshot.totalXp} team XP</span>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-2" aria-label="Cohort roster">
                    {cohort.snapshot.participants.map((participant) => (
                      <li key={participant.id} className="flex items-center justify-between gap-3 text-xs">
                        <span className="flex min-w-0 items-center gap-2 truncate text-aluminum-300">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${participant.online ? "bg-support" : "bg-aluminum-600"}`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{participant.name}</span>
                          {!participant.online && <span className="text-aluminum-600">reconnecting</span>}
                        </span>
                        <span className="shrink-0 font-mono text-aluminum-500">
                          {participant.completedCount}/{room.missions.length} · {participant.xp} XP
                        </span>
                      </li>
                    ))}
                  </ul>
                  {cohortPublishing && (
                    <p className="mt-3 font-mono text-[0.65rem] uppercase text-pool" role="status">
                      Publishing server-validated progress…
                    </p>
                  )}
                </div>
              ) : null}

              {cohortError && (
                <p className="mt-3 rounded-md border border-grievance/50 bg-grievance/10 p-3 text-xs leading-5 text-grievance" role="alert">
                  {cohortError}
                </p>
              )}
            </div>

            <div className="academy-ai-panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="eyebrow">AI-first flight deck</p>
                  <p className="mt-1 font-mono text-[0.62rem] uppercase tracking-wider text-aluminum-500">
                    Specify → Generate → Review → Validate
                  </p>
                </div>
                <span className="academy-ai-badge">Human owned</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-aluminum-300">
                Brief an AI as a junior engineer would in production. The mentor
                improves your specification and review plan; deterministic gates
                still decide whether the candidate is complete.
              </p>
              <label htmlFor="academy-ai-brief" className="mt-4 block font-mono text-[0.65rem] uppercase tracking-widest text-aluminum-400">
                AI engineering brief
              </label>
              <textarea
                id="academy-ai-brief"
                value={promptDraft}
                onChange={(event) => updatePromptDraft(event.target.value)}
                spellCheck={false}
                className="academy-prompt-editor"
              />
              <button
                type="button"
                onClick={askMentor}
                disabled={mentorLoading || promptDraft.trim().length < 20}
                className="mt-3 min-h-12 w-full rounded-lg border border-pool bg-pool/10 px-3 font-semibold text-pool hover:bg-pool hover:text-aluminum-950 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {mentorLoading ? "Mentor reviewing…" : "Review my AI brief"}
              </button>
              <p className="mt-2 text-[0.68rem] leading-5 text-aluminum-500">
                When live AI is enabled, this intentionally sends the brief and
                current candidate code to the configured OpenAI mentor. Otherwise,
                the local coach returns the same review workflow without transmitting code.
              </p>

              <div aria-live="polite">
                {mentorError && (
                  <p className="mt-3 rounded-md border border-grievance/50 bg-grievance/10 p-3 text-sm text-grievance">
                    {mentorError}
                  </p>
                )}
                {mentorReply && (
                  <div className="academy-mentor-response">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="display-header text-pool">Mentor review</strong>
                      <span className="font-mono text-[0.6rem] uppercase text-aluminum-500">
                        {mentorReply.mode === "live" ? mentorReply.model ?? "Live AI" : "Local coach"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-aluminum-300">{mentorReply.summary}</p>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-pool">
                        Improved generation prompt
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap rounded-md bg-aluminum-950 p-3 text-xs leading-5 text-aluminum-300">
                        {mentorReply.nextPrompt}
                      </pre>
                    </details>
                    <h3 className="mt-4 font-mono text-[0.65rem] uppercase tracking-widest text-aluminum-400">
                      Human review checklist
                    </h3>
                    <ul className="mt-2 space-y-2 text-xs leading-5 text-aluminum-300">
                      {mentorReply.reviewChecklist.map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="text-pool" aria-hidden="true">□</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="eyebrow">Validation gates</p>
              <ul className="mt-3 space-y-2" aria-live="polite">
                {(results.length > 0 ? results : activeMission.checks).map((check) => {
                  const result = "passed" in check ? check.passed : undefined;
                  return (
                    <li
                      key={check.id}
                      className={`academy-check ${result === true ? "passed" : ""} ${result === false ? "failed" : ""}`}
                    >
                      <span aria-hidden="true">{result === true ? "✓" : result === false ? "×" : "·"}</span>
                      <span>
                        <strong>{check.label}</strong>
                        {result === false && <small>{check.failureMessage}</small>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Mentor uplink</p>
                {hintCount < activeMission.hints.length && (
                  <button
                    type="button"
                    onClick={() => setHintCount((count) => count + 1)}
                    className="min-h-11 rounded-md border border-aluminum-600 px-3 text-xs text-aluminum-200 hover:border-pool hover:text-pool"
                  >
                    Reveal hint
                  </button>
                )}
              </div>
              {hintCount === 0 ? (
                <p className="mt-3 text-sm leading-6 text-aluminum-500">
                  Hints are staged. Try the mission before opening the uplink.
                </p>
              ) : (
                <ol className="mt-3 space-y-2 text-sm leading-6 text-aluminum-300">
                  {activeMission.hints.slice(0, hintCount).map((hint, index) => (
                    <li key={hint} className="flex gap-2">
                      <span className="font-mono text-pool">{index + 1}.</span>
                      <span>{hint}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="mt-auto pt-6">
              <button
                type="button"
                onClick={runChecks}
                className="display-header min-h-14 w-full rounded-lg border border-support bg-support/15 px-4 text-support transition-colors hover:bg-support hover:text-aluminum-950"
              >
                Run validation gates
              </button>
              {passed && (
                <div className="mt-3 rounded-lg border border-support/50 bg-support/10 p-4" role="status">
                  <strong className="display-header text-support">Gate cleared · +{activeMission.xp} XP</strong>
                  {activeIndex < room.missions.length - 1 && (
                    <button
                      type="button"
                      onClick={() => selectMission(activeIndex + 1)}
                      className="mt-3 min-h-11 w-full rounded-md bg-support px-3 font-semibold text-aluminum-950"
                    >
                      Enter next mission →
                    </button>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
