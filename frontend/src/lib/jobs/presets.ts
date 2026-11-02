// Presets are PREFILLED GENERIC JOBS, nothing more: GET /api/presets serves
// them, a UI lets the user edit the example values, and POST /api/jobs
// validates the result like any other job.

import type { Job, Network } from "./types";

export type JobTemplate = Omit<Job, "id" | "owner" | "createdAt" | "paused" | "poolId"> & {
  preset: string;
  title: string;
  description: string;
  // false when a contract the template calls is not deployed on this network,
  // or when only the Foundation can run it
  available: boolean;
  unavailableReason?: string;
  systemOnly?: boolean;
};

// Generic contracts we deploy once per network (contracts/web_probe.py,
// contracts/ask.py, contracts/heartbeat.py).
export interface PresetContracts {
  webprobe: string | null;
  ask: string | null;
  heartbeat: string | null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v && ADDRESS.test(v) ? v : null;
}

export function presetContracts(n: Network): PresetContracts {
  const N = n === "studio" ? "STUDIO" : "BRADBURY";
  return {
    webprobe: env(`UPTIME_WEBPROBE_${N}`),
    ask: env(`UPTIME_ASK_${N}`),
    heartbeat: n === "bradbury" ? env("HEARTBEAT_CONTRACT") : null,
  };
}

const ZERO = "0x0000000000000000000000000000000000000000";
// Preset contracts file results under the CALLER (our relayer), keyed by run.
const getRun = ["{{relayer}}", "{{job_id}}", "{{run_id}}"];

export function templates(network: Network, c: PresetContracts = presetContracts(network)): JobTemplate[] {
  const need = (addr: string | null, what: string) =>
    addr ? { available: true } : { available: false, unavailableReason: `${what} is not deployed on this network yet` };
  return [
    {
      preset: "heartbeat",
      title: "Example: Bradbury Heartbeat",
      description: "Our own public example job: every hour a canary deploy, a state write, a web fetch and two probes graded on-chain (LLM, web, image) on Testnet Bradbury, plus an appeal every 5th hour.",
      name: "Bradbury Heartbeat",
      network: "bradbury",
      schedule: { everyMinutes: 60 },
      steps: [
        { id: "canary", kind: "deploy", preset: "canary", args: ["{{slot}}"] },
        { id: "bump", kind: "write", contract: c.heartbeat ?? ZERO, method: "bump", args: ["{{slot}}"] },
        { id: "status", kind: "write", contract: c.heartbeat ?? ZERO, method: "probe_status", args: ["{{slot}}"] },
        { id: "probe", kind: "write", contract: c.heartbeat ?? ZERO, method: "probe", args: ["{{slot}}", "<rotating probe id>"] },
      ],
      assertions: [],
      public: true,
      systemOnly: true,
      available: false,
      unavailableReason: "Run by the Foundation; its results are public",
    },
    {
      preset: "check-url",
      title: "Check a URL",
      description: "Validators fetch a page and agree on whether the status matches and the body contains a string.",
      name: "Check https://example.com",
      network,
      schedule: { everyMinutes: 60 },
      steps: [
        { id: "check", kind: "write", contract: c.webprobe ?? ZERO, method: "check_url", args: ["{{job_id}}", "{{run_id}}", "https://example.com", 0, ""] },
        { id: "result", kind: "read", contract: c.webprobe ?? ZERO, method: "get_run", args: getRun },
      ],
      assertions: [{ step: "result", path: "result.ok", op: "eq", expected: true }],
      ...need(c.webprobe, "The WebProbe contract"),
    },
    {
      preset: "check-api",
      title: "Check an API",
      description: "Fetch JSON, take the value at a path and compare it; a tolerance lets prices and counters agree.",
      name: "Check an API",
      network,
      schedule: { everyMinutes: 60 },
      steps: [
        {
          id: "check", kind: "write", contract: c.webprobe ?? ZERO, method: "check_api",
          args: ["{{job_id}}", "{{run_id}}", "https://api.example.com/status", "data.status", "eq", "ok", ""],
        },
        { id: "result", kind: "read", contract: c.webprobe ?? ZERO, method: "get_run", args: getRun },
      ],
      assertions: [{ step: "result", path: "result.ok", op: "eq", expected: true }],
      ...need(c.webprobe, "The WebProbe contract"),
    },
    {
      preset: "ask",
      title: "Ask the web",
      description: "Optionally read a page, ask the validators' LLMs a question, and record their short agreed answer.",
      name: "Ask a question",
      network,
      schedule: { everyMinutes: 60 },
      steps: [
        { id: "ask", kind: "write", contract: c.ask ?? ZERO, method: "ask", args: ["{{job_id}}", "{{run_id}}", "Is https://example.com up? yes or no", "https://example.com"] },
        { id: "result", kind: "read", contract: c.ask ?? ZERO, method: "get_run", args: getRun },
      ],
      assertions: [{ step: "result", path: "answer", op: "eq", expected: "yes" }],
      ...need(c.ask, "The Ask contract"),
    },
    {
      preset: "call-contract",
      title: "Call a contract method",
      description: "Send a write tx to any contract, yours included, with any args; then read a view and assert on it.",
      name: "Call my contract",
      network,
      schedule: { everyMinutes: 60 },
      steps: [
        { id: "call", kind: "write", contract: ZERO, method: "update", args: [] },
        { id: "check", kind: "read", contract: ZERO, method: "get_status", args: [] },
      ],
      assertions: [{ step: "check", op: "exists" }],
      available: true,
    },
    {
      preset: "deploy-contract",
      title: "Deploy a contract",
      description: "Deploy contract code on a schedule and record time to ACCEPTED. Starts from our canary; paste your own code instead.",
      name: "Deploy a canary",
      network,
      schedule: { everyMinutes: 60 },
      steps: [{ id: "deploy", kind: "deploy", preset: "canary", args: ["{{slot}}"] }],
      assertions: [{ step: "deploy", path: "address", op: "exists" }],
      available: true,
    },
    {
      preset: "deploy-then-call",
      title: "Deploy every hour, call every 5 minutes",
      description: "Chained steps: one deploys a fresh instance, the other calls a method on the latest accepted deploy.",
      name: "Deploy, then call",
      network,
      schedule: { everyMinutes: 60 },
      steps: [
        { id: "deploy", kind: "deploy", preset: "canary", args: ["{{slot}}"] },
        // The canary only has a view; point this at a write method of your own contract.
        { id: "check", kind: "read", contract: "$deploy.address", method: "get_tick", args: [], schedule: { everyMinutes: 5 } },
      ],
      assertions: [{ step: "check", op: "gt", expected: 0 }],
      available: true,
    },
  ];
}
