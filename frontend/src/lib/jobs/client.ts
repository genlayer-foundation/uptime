// Typed browser client for the Uptime jobs API (shared contract: ./types.ts).
//
// With NEXT_PUBLIC_JOBS_MOCK=1 every call is answered by the in-memory dev
// mock (./mock.ts) instead of the network, so the jobs pages are reviewable
// before the backend lands. The flag is inlined at build time; without it the
// mock module is never loaded. It is honoured ONLY under `next dev`: any build
// (`next build`, Vercel preview or production) inlines NODE_ENV="production",
// so mock data is impossible there even if the variable is set.
//
// Response shapes the shared contract does not pin down are parsed
// tolerantly: a list may come back bare (`Job[]`) or wrapped (`{ jobs }`).

import type { Assertion, Job, Network, Run, Schedule, Step } from "./types";

export const JOBS_MOCK = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_JOBS_MOCK === "1";

export type Me = { ready: boolean; wallet: string | null; studioAllowed: boolean; isAdmin?: boolean };

export type PresetAvailability = { ok: boolean; reason?: string };

export type PresetTemplate = { steps: Step[]; schedule?: Schedule; assertions?: Assertion[] };

export type Preset = {
  id: string;
  name: string;
  description?: string;
  /** Networks the preset runs on; absent = both. */
  networks?: Network[];
  availability?: Partial<Record<Network, PresetAvailability>>;
  /** Run by the system (e.g. the Bradbury Heartbeat); users cannot create it. */
  systemOnly?: boolean;
  /** A starting job the wizard pre-fills (contract addresses of the default network). */
  template?: PresetTemplate;
  /** The same template per network: preset contracts live at different addresses. */
  templates?: Partial<Record<Network, PresetTemplate>>;
};

/** The preset's template for one network, falling back to the default one. */
export function presetTemplate(p: Preset, n: Network): PresetTemplate | undefined {
  return p.templates?.[n] ?? p.template;
}

export type PresetsResponse = {
  minIntervalSec?: number;
  pool?: { bradbury?: string | null };
  presets: Preset[];
};

/** Fields the client sends to create a job; the server assigns id/owner/createdAt and the Bradbury poolId. */
export type NewJob = Pick<Job, "name" | "network" | "schedule" | "steps" | "assertions"> &
  Partial<Pick<Job, "preset" | "public" | "paused">>;

export type JobPatch = Partial<Pick<Job, "name" | "schedule" | "steps" | "assertions" | "public" | "poolId">>;

/** One flat row per step run, the `format=rows` export (Grafana Infinity). */
export type RunRow = {
  runId: string;
  jobId: string;
  startedAt: string;
  pass: boolean | null;
  stepId: string;
  status: string;
  txHash?: string;
  timeToAcceptedMs?: number;
  gasGen?: string;
  error?: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

let mockFetch: Promise<Fetch> | null = null;
function transport(): Promise<Fetch> {
  if (!JOBS_MOCK) return Promise.resolve((i, init) => fetch(i, init));
  mockFetch ??= import("./mock").then((m) => m.mockFetch);
  return mockFetch;
}

/** One API call through the same transport (and mock) as the jobs pages. */
export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  return call<T>(method, path, body);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const f = await transport();
  const res = await f(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const apiMsg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
    const msg = apiMsg || `${method} ${path} failed (${res.status})`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

function unwrap<T>(data: unknown, key: string): T {
  if (data && typeof data === "object" && !Array.isArray(data) && key in data) {
    return (data as Record<string, T>)[key];
  }
  return data as T;
}

const enc = encodeURIComponent;

export const jobsApi = {
  // ---- auth (SIWE) ----
  async nonce(): Promise<string> {
    let data: unknown;
    try {
      data = await call<unknown>("POST", "/api/auth/nonce");
    } catch (e) {
      // Some backends expose the nonce as GET only.
      if (e instanceof ApiError && e.status === 405) data = await call<unknown>("GET", "/api/auth/nonce");
      else throw e;
    }
    return unwrap<string>(data, "nonce");
  },
  verify: (message: string, signature: string) =>
    call<{ wallet: string; studioAllowed: boolean }>("POST", "/api/auth/verify", { message, signature }),
  logout: () => call<{ ok: boolean }>("POST", "/api/auth/logout"),
  async me(): Promise<Me> {
    try {
      const d = await call<Partial<Me> & { address?: string }>("GET", "/api/me");
      return { ready: d.ready ?? true, wallet: d.wallet ?? d.address ?? null, studioAllowed: !!d.studioAllowed };
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return { ready: true, wallet: null, studioAllowed: false };
      // No jobs backend deployed on this server: sign-in is simply unavailable.
      if (e instanceof ApiError && e.status === 404) return { ready: false, wallet: null, studioAllowed: false };
      throw e;
    }
  },

  // ---- jobs ----
  listJobs: async () => unwrap<Job[]>(await call("GET", "/api/jobs"), "jobs"),
  listPublicJobs: async () => unwrap<Job[]>(await call("GET", "/api/jobs?public=1"), "jobs"),
  getJob: async (id: string) => unwrap<Job>(await call("GET", `/api/jobs/${enc(id)}`), "job"),
  createJob: async (job: NewJob) => unwrap<Job>(await call("POST", "/api/jobs", job), "job"),
  updateJob: async (id: string, patch: JobPatch) => unwrap<Job>(await call("PATCH", `/api/jobs/${enc(id)}`, patch), "job"),
  deleteJob: (id: string) => call<unknown>("DELETE", `/api/jobs/${enc(id)}`),
  pauseJob: async (id: string) => unwrap<Job>(await call("POST", `/api/jobs/${enc(id)}/pause`), "job"),
  resumeJob: async (id: string) => unwrap<Job>(await call("POST", `/api/jobs/${enc(id)}/resume`), "job"),

  // ---- runs ----
  runsUrl: (id: string, opts: { limit?: number; format?: "json" | "rows" } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.format) q.set("format", opts.format);
    const s = q.toString();
    return `/api/jobs/${enc(id)}/runs${s ? `?${s}` : ""}`;
  },
  listRuns: async (id: string, limit = 200) =>
    unwrap<Run[]>(await call("GET", jobsApi.runsUrl(id, { limit, format: "json" })), "runs"),
  listRunRows: async (id: string, limit = 1000) =>
    unwrap<RunRow[]>(await call("GET", jobsApi.runsUrl(id, { limit, format: "rows" })), "rows"),

  // ---- presets ----
  async presets(): Promise<PresetsResponse> {
    const d = await call<unknown>("GET", "/api/presets");
    if (Array.isArray(d)) return { presets: d as Preset[] };
    return d as PresetsResponse;
  },
};

export type JobsApi = typeof jobsApi;

/**
 * Whether this server can serve the jobs pages, by probing GET /api/me:
 *   "missing"         404: the jobs API is not deployed on this server
 *   "not_configured"  the API is there but answers ready:false
 *                     (DATABASE_URL or SESSION_SECRET not set)
 *   "ready"           anything else; a network error or 5xx is left for the
 *                     page itself to report
 */
export type BackendState = "missing" | "not_configured" | "ready";

export async function jobsBackendState(): Promise<BackendState> {
  if (JOBS_MOCK) return "ready";
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (res.status === 404) return "missing";
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ready?: boolean } | null;
      if (body?.ready === false) return "not_configured";
    }
    return "ready";
  } catch {
    return "ready";
  }
}
