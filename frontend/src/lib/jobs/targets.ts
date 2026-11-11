// What a user job may call. Server-only (reads env); enforced twice, like every
// gate: at create/edit (service.ts) and before every submit (executor.ts).
//
// Why: every scheduled step is signed by ONE key per network, the relayer, and
// on Bradbury that same key is the Heartbeat contract's operator and the pools'
// scheduler. Without these rules a user job would act with the relayer's
// authority (a confused deputy):
//   - a write to the Heartbeat contract would forge the public benchmark;
//   - a write to a preset contract (WebProbe, Ask) with someone else's job id
//     would overwrite that job's record, since those contracts file results
//     under <caller = relayer>|<uptime_id>.
// So: system contracts are never a write target, and the id a preset contract
// files under is always this job's own, set by the server ({{job_id}}).
// Reads are not restricted: they sign nothing.

import { BRADBURY_PHASE2 } from "@/lib/chains";
import { parseWalletList } from "./allowlist";
import type { Step } from "./types";

type Env = Record<string, string | undefined>;

// Env vars that each hold ONE system contract address.
const SYSTEM_ENV = [
  "HEARTBEAT_CONTRACT",
  "NEXT_PUBLIC_HEARTBEAT_CONTRACT",
  "UPTIME_POOL_BRADBURY",
  "NEXT_PUBLIC_UPTIME_POOL_BRADBURY",
  "UPTIME_POOL_V2_BRADBURY",
];
// Preset contracts whose records are keyed by a caller-supplied id.
const PRESET_ENV = ["UPTIME_WEBPROBE_STUDIO", "UPTIME_WEBPROBE_BRADBURY", "UPTIME_ASK_STUDIO", "UPTIME_ASK_BRADBURY"];
const OWN_ID = new Set(["{{job_id}}", "{{uptime_id}}"]);

function listed(names: string[], env: Env): Set<string> {
  return parseWalletList(names.map((n) => env[n] ?? "").join(","));
}

/**
 * Addresses no user job may write to: the Heartbeat contract, the pools, the
 * network's consensus contracts, and anything in UPTIME_BLOCKED_TARGETS
 * (comma-separated, for system contracts deployed later). Lowercase.
 */
export function systemTargets(env: Env = process.env): Set<string> {
  const out = listed(SYSTEM_ENV, env);
  for (const a of Object.values(BRADBURY_PHASE2.contracts)) out.add(a.toLowerCase());
  for (const a of parseWalletList(env.UPTIME_BLOCKED_TARGETS)) out.add(a);
  return out;
}

export function presetTargets(env: Env = process.env): Set<string> {
  return listed(PRESET_ENV, env);
}

/** Why these steps may not be saved, or null. Addresses behind "$step.address" are checked at run time. */
export function stepsRefusal(steps: Step[], env: Env = process.env): string | null {
  const system = systemTargets(env);
  const presets = presetTargets(env);
  for (const s of steps) {
    if (s.kind !== "write") continue;
    const to = s.contract.toLowerCase();
    if (system.has(to)) return `step "${s.id}": ${s.contract} is a system contract and cannot be called by a job`;
    if (presets.has(to) && !(typeof s.args[0] === "string" && OWN_ID.has(s.args[0]))) {
      return `step "${s.id}": the first argument of ${s.method} must be {{job_id}}`;
    }
  }
  return null;
}

/**
 * The same rules on the call about to be signed, with every placeholder and
 * "$step.address" resolved. Returns why it is refused, or null.
 */
export function callRefusal(
  job: { id: string },
  step: Step,
  address: string | undefined,
  args: unknown[],
  relayer: string,
  env: Env = process.env
): string | null {
  if (step.kind !== "write") return null;
  const to = (address ?? "").toLowerCase();
  if (systemTargets(env).has(to) || to === relayer.toLowerCase()) return `${address} is a system contract and cannot be called by a job`;
  if (presetTargets(env).has(to) && args[0] !== job.id) return `the first argument of ${step.method} must be this job's id ({{job_id}})`;
  return null;
}
