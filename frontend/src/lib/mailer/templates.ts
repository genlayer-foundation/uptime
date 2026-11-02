// FIXED templates (§11.4.3). The only user-controlled text that can reach an
// email is the job name: sanitized, capped at 60 chars, URL-defanged, and
// HTML-escaped in the HTML part. Everything else is our own wording or a value
// from a closed vocabulary, so the service cannot be used as a spam relay.
// There is deliberately no Markdown or rich-text renderer.

import { JOB_NAME_MAX } from "./config";
import type { AlertJob, AlertRun, Network } from "./types";

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: [string, string][];
}

// C0/C1 controls, zero-width and bidi-override characters.
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff-\\ufeff]", "g");

/** Job name as it may appear in a subject, a text part and (escaped) an HTML part. */
export function safeJobName(name: unknown): string {
  let s = typeof name === "string" ? name : "";
  s = s.normalize("NFKC").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  // No clickable links from user text: break schemes and bare www. hosts.
  s = s.replace(/:\/\//g, ":/ /").replace(/\bwww\./gi, "www ");
  if (s.length > JOB_NAME_MAX) s = s.slice(0, JOB_NAME_MAX - 1).trimEnd() + "…";
  return s || "Untitled job";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** System ids (job, run) are ours, but are still reduced to a safe charset. */
function safeId(v: unknown): string {
  return String(v ?? "").replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 64) || "?";
}

const STATUS_TEXT: Record<string, string> = {
  UNDETERMINED: "consensus was undetermined",
  TIMEOUT: "a transaction timed out",
  SUBMIT_FAILED: "a transaction could not be submitted",
  ERROR: "a step errored",
  PENDING: "a step did not finish",
};

/** Closed-vocabulary reason for the failure. Step ids (user text) are never included. */
export function failureReason(run: AlertRun): string {
  for (const s of run.steps ?? []) {
    if (s.status !== "ACCEPTED" && s.status !== "FINALIZED") {
      return STATUS_TEXT[String(s.status)] ?? "a step did not reach ACCEPTED";
    }
  }
  return "an assertion failed";
}

const NETWORK_TEXT: Record<Network, string> = { studio: "Studio", bradbury: "Bradbury testnet" };

function footer(unsub: string): { text: string; html: string } {
  const line =
    "You get this because this address was confirmed for alerts on GenLayer Uptime. " +
    "GenLayer Uptime is testnet software and is NOT AUDITED.";
  return {
    text: `--\n${line}\nStop all Uptime email to this address: ${unsub}\n`,
    html:
      `<hr style="border:0;border-top:1px solid #ddd;margin:24px 0 12px">` +
      `<p style="font-size:12px;color:#666">${escapeHtml(line)}<br>` +
      `<a href="${escapeHtml(unsub)}">Stop all Uptime email to this address</a></p>`,
  };
}

function wrap(body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#111;max-width:560px">${body}</body></html>`;
}

/** RFC 2369 + RFC 8058 one-click unsubscribe, RFC 3834 auto-submitted. */
export function listHeaders(unsub: string): [string, string][] {
  return [
    ["List-Unsubscribe", `<${unsub}>`],
    ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
    ["Auto-Submitted", "auto-generated"],
  ];
}

export function alertMessage(
  to: string,
  job: AlertJob,
  run: AlertRun,
  links: { unsubscribe: string; dashboard: string }
): Message {
  const name = safeJobName(job.name);
  const reason = failureReason(run);
  const network = NETWORK_TEXT[job.network] ?? "GenLayer";
  const jobId = safeId(job.id);
  const runId = safeId(run.id);
  const f = footer(links.unsubscribe);
  const subject = `[Uptime] Job failed: ${name}`;
  const text =
    `Your Uptime job "${name}" failed on ${network}: ${reason}.\n\n` +
    `Job: ${jobId}\nRun: ${runId}\n\n` +
    `Open the job: ${links.dashboard}\n\n` +
    `Repeated failures are rate-limited, so you may not get an email for every failed run.\n\n` +
    f.text;
  const html = wrap(
    `<p>Your Uptime job <strong>${escapeHtml(name)}</strong> failed on ${escapeHtml(network)}: ${escapeHtml(reason)}.</p>` +
      `<p style="color:#444">Job: <code>${escapeHtml(jobId)}</code><br>Run: <code>${escapeHtml(runId)}</code></p>` +
      `<p><a href="${escapeHtml(links.dashboard)}">Open the job</a></p>` +
      `<p style="color:#666">Repeated failures are rate-limited, so you may not get an email for every failed run.</p>` +
      f.html
  );
  return { to, subject, text, html, headers: listHeaders(links.unsubscribe) };
}

export function verificationMessage(
  to: string,
  wallet: string,
  links: { confirm: string; unsubscribe: string }
): Message {
  const f = footer(links.unsubscribe);
  const subject = "[Uptime] Confirm this address for job alerts";
  const text =
    `The wallet ${wallet} asked to send GenLayer Uptime job alerts to this address.\n\n` +
    `Confirm (link valid for 24 hours): ${links.confirm}\n\n` +
    `If you did not ask for this, ignore this email: nothing is sent until the address is confirmed.\n\n` +
    f.text;
  const html = wrap(
    `<p>The wallet <code>${escapeHtml(wallet)}</code> asked to send GenLayer Uptime job alerts to this address.</p>` +
      `<p><a href="${escapeHtml(links.confirm)}">Confirm this address</a> (valid for 24 hours)</p>` +
      `<p style="color:#666">If you did not ask for this, ignore this email: nothing is sent until the address is confirmed.</p>` +
      f.html
  );
  return { to, subject, text, html, headers: listHeaders(links.unsubscribe) };
}

export function recoveryMessage(
  to: string,
  job: AlertJob,
  run: AlertRun,
  links: { unsubscribe: string; dashboard: string }
): Message {
  const name = safeJobName(job.name);
  const network = NETWORK_TEXT[job.network] ?? "GenLayer";
  const jobId = safeId(job.id);
  const runId = safeId(run.id);
  const f = footer(links.unsubscribe);
  const subject = `[Uptime] Job recovered: ${name}`;
  const text =
    `Your Uptime job "${name}" passed again on ${network}.\n\n` +
    `Job: ${jobId}\nRun: ${runId}\n\n` +
    `Open the job: ${links.dashboard}\n\n` +
    f.text;
  const html = wrap(
    `<p>Your Uptime job <strong>${escapeHtml(name)}</strong> passed again on ${escapeHtml(network)}.</p>` +
      `<p style="color:#444">Job: <code>${escapeHtml(jobId)}</code><br>Run: <code>${escapeHtml(runId)}</code></p>` +
      `<p><a href="${escapeHtml(links.dashboard)}">Open the job</a></p>` +
      f.html
  );
  return { to, subject, text, html, headers: listHeaders(links.unsubscribe) };
}

/** Counts only: the digest carries no user text beyond the job name. */
export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** Closed-vocabulary reason of the newest failed run, if any. */
  lastFailure: { reason: string; at: string | null } | null;
}

/** The last 24 h of `runs` (runs without `startedAt` are counted, the caller already windowed them). */
export function summarizeRuns(runs: AlertRun[], now: Date): RunSummary {
  const since = now.getTime() - 24 * 3600_000;
  const inWindow = runs.filter((r) => {
    if (!r.startedAt) return true;
    const t = Date.parse(r.startedAt);
    return Number.isFinite(t) && t >= since && t <= now.getTime();
  });
  const isStepFail = (r: AlertRun) => (r.steps ?? []).some((s) => s.status !== "PENDING" && s.status !== "ACCEPTED" && s.status !== "FINALIZED");
  const failedRuns = inWindow.filter((r) => r.pass === false || isStepFail(r));
  const passed = inWindow.filter((r) => r.pass === true && !isStepFail(r)).length;
  const newest = [...failedRuns].sort((a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? ""))[0];
  return {
    total: inWindow.length,
    passed,
    failed: failedRuns.length,
    pending: inWindow.length - passed - failedRuns.length,
    lastFailure: newest ? { reason: failureReason(newest), at: newest.startedAt && Number.isFinite(Date.parse(newest.startedAt)) ? new Date(newest.startedAt).toISOString() : null } : null,
  };
}

export function digestMessage(
  to: string,
  job: AlertJob,
  s: RunSummary,
  links: { unsubscribe: string; dashboard: string }
): Message {
  const name = safeJobName(job.name);
  const network = NETWORK_TEXT[job.network] ?? "GenLayer";
  const decided = s.passed + s.failed;
  const rate = decided ? `${Math.round((s.passed / decided) * 1000) / 10}%` : "n/a";
  const f = footer(links.unsubscribe);
  const subject = `[Uptime] Daily digest: ${name}`;
  const counts = `${s.total} runs: ${s.passed} passed, ${s.failed} failed${s.pending ? `, ${s.pending} still running` : ""} (pass rate ${rate}).`;
  const last = s.lastFailure ? `Last failure: ${s.lastFailure.reason}${s.lastFailure.at ? ` at ${s.lastFailure.at.replace("T", " ").slice(0, 16)} UTC` : ""}.` : "No failures.";
  const text =
    `Your Uptime job "${name}" on ${network}, last 24 hours:\n\n${counts}\n${last}\n\n` +
    `Open the job: ${links.dashboard}\n\n` +
    f.text;
  const html = wrap(
    `<p>Your Uptime job <strong>${escapeHtml(name)}</strong> on ${escapeHtml(network)}, last 24 hours:</p>` +
      `<p>${escapeHtml(counts)}<br>${escapeHtml(last)}</p>` +
      `<p><a href="${escapeHtml(links.dashboard)}">Open the job</a></p>` +
      f.html
  );
  return { to, subject, text, html, headers: listHeaders(links.unsubscribe) };
}
