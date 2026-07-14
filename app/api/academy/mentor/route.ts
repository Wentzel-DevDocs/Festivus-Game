import { NextResponse } from "next/server";
import { getAcademyRoom } from "@/lib/academy/catalog";

interface MentorRequestBody {
  roomSlug?: unknown;
  missionId?: unknown;
  promptDraft?: unknown;
  code?: unknown;
}

interface MentorReply {
  mode: "live" | "offline";
  summary: string;
  nextPrompt: string;
  risks: string[];
  reviewChecklist: string[];
  model?: string;
}

interface OpenAIResponsePayload {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

const requestWindows = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;

function getClientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function isRateLimited(request: Request) {
  const now = Date.now();
  const key = getClientKey(request);
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

function findOutputText(payload: OpenAIResponsePayload) {
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return undefined;
}

function isMentorPayload(value: unknown): value is Omit<MentorReply, "mode" | "model"> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.summary === "string" &&
    typeof candidate.nextPrompt === "string" &&
    Array.isArray(candidate.risks) &&
    candidate.risks.every((item) => typeof item === "string") &&
    Array.isArray(candidate.reviewChecklist) &&
    candidate.reviewChecklist.every((item) => typeof item === "string")
  );
}

function offlineReply(
  promptDraft: string,
  mission: NonNullable<ReturnType<typeof getAcademyRoom>>["missions"][number],
): MentorReply {
  const missingSections = [
    !/act as|role|engineer|architect|reviewer/i.test(promptDraft) && "a clear expert role",
    !/requirement|criteria|constraint|must|preserve/i.test(promptDraft) && "explicit constraints",
    !/test|verify|validation|checklist/i.test(promptDraft) && "verification instructions",
    !/do not|never|without/i.test(promptDraft) && "non-goals or forbidden changes",
  ].filter(Boolean) as string[];

  return {
    mode: "offline",
    summary:
      missingSections.length === 0
        ? "Your AI brief includes a role, constraints, verification, and non-goals. Generate a candidate, then treat the validation gates—not the model's confidence—as the source of truth."
        : `Strengthen the brief with ${missingSections.join(", ")}. The local mentor never executes or approves generated code.`,
    nextPrompt: mission.aiWorkflow.promptTemplate,
    risks: [
      "A model can return plausible code that violates an unstated product constraint.",
      "Generated code is unverified until deterministic checks and human review pass.",
      ...mission.aiWorkflow.reviewQuestions.slice(0, 1),
    ],
    reviewChecklist: [
      ...mission.aiWorkflow.reviewQuestions,
      ...mission.checks.slice(0, 3).map((check) => `Confirm: ${check.label}.`),
    ],
  };
}

async function requestLiveMentor(args: {
  missionTitle: string;
  objective: string;
  promptDraft: string;
  code: string;
  reviewQuestions: string[];
}): Promise<MentorReply | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || process.env.ACADEMY_AI_ENABLED !== "true") return undefined;

  const model = process.env.OPENAI_ACADEMY_MODEL || "gpt-5.6";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      instructions:
        "You are a senior software mentor teaching AI-first engineering. Improve the learner's specification and review discipline. Do not provide a final implementation. Never claim code is correct or tests passed. Return only the requested structured response.",
      input: [
        `Mission: ${args.missionTitle}`,
        `Objective: ${args.objective}`,
        `Learner AI brief:\n${args.promptDraft}`,
        `Current candidate code:\n${args.code}`,
        `Required human review questions:\n- ${args.reviewQuestions.join("\n- ")}`,
      ].join("\n\n"),
      max_output_tokens: 1_200,
      text: {
        format: {
          type: "json_schema",
          name: "academy_mentor_reply",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              nextPrompt: { type: "string" },
              risks: { type: "array", items: { type: "string" } },
              reviewChecklist: { type: "array", items: { type: "string" } },
            },
            required: ["summary", "nextPrompt", "risks", "reviewChecklist"],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI request failed with ${response.status}`);
  }

  const outputText = findOutputText(payload);
  if (!outputText) throw new Error("OpenAI response contained no output text");
  const parsed: unknown = JSON.parse(outputText);
  if (!isMentorPayload(parsed)) throw new Error("OpenAI response did not match mentor schema");
  return { ...parsed, mode: "live", model };
}

export async function POST(request: Request) {
  if (isRateLimited(request)) {
    return NextResponse.json(
      { error: "Mentor uplink cooling down. Try again in one minute." },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: MentorRequestBody;
  try {
    body = (await request.json()) as MentorRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const roomSlug = typeof body.roomSlug === "string" ? body.roomSlug : "";
  const missionId = typeof body.missionId === "string" ? body.missionId : "";
  const promptDraft = typeof body.promptDraft === "string" ? body.promptDraft.trim() : "";
  const code = typeof body.code === "string" ? body.code : "";

  if (!roomSlug || !missionId || promptDraft.length < 20 || promptDraft.length > 6_000 || code.length > 24_000) {
    return NextResponse.json(
      { error: "Room, mission, a meaningful AI brief, and reasonably sized code are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const room = getAcademyRoom(roomSlug);
  const mission = room?.missions.find((candidate) => candidate.id === missionId);
  if (!room || !mission || room.status !== "playable") {
    return NextResponse.json({ error: "Playable academy mission not found" }, { status: 404 });
  }

  let reply: MentorReply | undefined;
  try {
    reply = await requestLiveMentor({
      missionTitle: mission.title,
      objective: mission.objective,
      promptDraft,
      code,
      reviewQuestions: mission.aiWorkflow.reviewQuestions,
    });
  } catch (error) {
    console.warn("Academy live mentor unavailable; using local coaching", error);
  }

  return NextResponse.json(reply ?? offlineReply(promptDraft, mission), {
    headers: { "Cache-Control": "no-store" },
  });
}
