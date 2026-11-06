// What a person can set up, in their words. ONE list drives both the home
// page's "What you can check" cards and the first screen of the job wizard.
// Each task opens one template from lib/jobs/presets.ts (served by
// /api/presets); test/tasks.test.ts fails if a task names a template that
// does not exist. The Heartbeat template is the Foundation's and is not a task.

export type TaskId = "website" | "api" | "ai" | "call" | "deploy" | "deploy-call";

export interface Task {
  id: TaskId;
  /** The lib/jobs/presets.ts template this task starts from. */
  preset: string;
  /** Wizard card title. */
  title: string;
  /** Wizard card one-liner. */
  line: string;
}

export const TASKS: Task[] = [
  { id: "website", preset: "check-url", title: "Check a website", line: "Is a page up, and does it say what it should?" },
  { id: "api", preset: "check-api", title: "Check an API", line: "Read a JSON value and fail when it is not what you expect." },
  { id: "ai", preset: "ask", title: "Ask an AI", line: "Ask a question on a schedule; validators agree on the answer." },
  { id: "call", preset: "call-contract", title: "Call a contract", line: "Send a transaction to your Intelligent Contract on a schedule." },
  { id: "deploy", preset: "deploy-contract", title: "Deploy a contract", line: "Deploy an Intelligent Contract on a schedule and time how long it takes." },
  { id: "deploy-call", preset: "deploy-then-call", title: "Deploy, then call", line: "Deploy a fresh copy, then call the newest one on its own schedule." },
];

export function taskById(id: string | null | undefined): Task | undefined {
  return TASKS.find((t) => t.id === id);
}

export function taskForPreset(preset: string | undefined): Task | undefined {
  return TASKS.find((t) => t.preset === preset);
}

/** The home page's four items. Each links into the wizard at its task. */
export const SHOWCASE: Array<{ title: string; line: string; task: TaskId }> = [
  { title: "Website", line: "Up, and showing the right text.", task: "website" },
  { title: "API", line: "A status code or JSON field.", task: "api" },
  { title: "AI answer", line: "One question, asked on a schedule.", task: "ai" },
  { title: "Contract", line: "Call or deploy on a schedule.", task: "call" },
];
