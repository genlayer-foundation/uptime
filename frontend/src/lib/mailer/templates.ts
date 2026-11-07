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

const NETWORK_TEXT: Record<Network, string> = { studio: "GenLayer Studio", bradbury: "GenLayer Testnet Bradbury" };

// ---- HTML frame -------------------------------------------------------------
// Email-safe: tables, inline styles, a system font stack (no webfonts), the
// pulse mark as a hosted PNG (Gmail does not render SVG). Colours are the site
// tokens from src/app/globals.css. The <style> block only adds dark-mode
// overrides for clients that honour it; Gmail ignores it and inverts on its own.

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
const C = { bg: "#fafafa", card: "#ffffff", fg: "#18181b", muted: "#71717a", subtle: "#a1a1aa", border: "#e4e4e7", purple: "#9b6af6" };
const PROD = "https://uptime.genlayer.foundation";

type Tone = "danger" | "success" | "muted";
const TONE: Record<Tone, string> = { danger: "#dc2626", success: "#059669", muted: C.muted };

/** Origin of one of our own links (the logo is served from the same deployment). */
function originOf(link: string): string {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : PROD;
  } catch {
    return PROD;
  }
}

/** 0x3b49…3da97: enough to recognise, short enough to read. */
export function shortWallet(w: string): string {
  const s = String(w ?? "").replace(/[^A-Za-z0-9]/g, "");
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-5)}` : s || "?";
}

/** A bulletproof button: table cell carries the colour, so it survives clients that strip padding on <a>. */
function button(href: string, label: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0"><tr>` +
    `<td class="btn" bgcolor="${C.fg}" style="border-radius:8px;background:${C.fg}">` +
    `<a class="btn" href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:14px;font-weight:600;line-height:18px;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

function para(html: string, extra = ""): string {
  return `<p style="margin:8px 0 0;font-size:14px;line-height:22px;color:${C.muted};${extra}" class="muted">${html}</p>`;
}

function mono(s: string): string {
  return `<span style="font-family:${MONO};font-size:12px">${escapeHtml(s)}</span>`;
}

function frame(o: { title: string; label?: { text: string; tone: Tone }; body: string; unsubscribe: string }): string {
  const origin = originOf(o.unsubscribe);
  const label = o.label
    ? `<div style="font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${TONE[o.label.tone]};margin:0 0 6px">${escapeHtml(o.label.text)}</div>`
    : "";
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">` +
    `<title>${escapeHtml(o.title)}</title>` +
    `<style>@media (prefers-color-scheme:dark){` +
    `.bg{background:#09090b!important}.card{background:#18181b!important;border-color:#27272a!important}` +
    `.fg{color:#f4f4f5!important}.muted{color:#a1a1aa!important}td.btn{background:#f4f4f5!important}a.btn{color:#18181b!important}}</style>` +
    `</head><body class="bg" style="margin:0;padding:0;background:${C.bg}">` +
    `<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg}">` +
    `<tr><td align="center" style="padding:32px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;font-family:${FONT}">` +
    // lockup, as the site header renders it: pulse mark, "Uptime", "by GenLayer"
    `<tr><td style="padding:0 4px 16px"><a href="${escapeHtml(origin)}" target="_blank" style="text-decoration:none">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="vertical-align:middle;padding-right:10px"><img src="${escapeHtml(origin)}/email/uptime-mark.png" width="20" height="20" alt="" style="display:block;border:0;width:20px;height:20px"></td>` +
    `<td class="fg" style="vertical-align:middle;font-family:${FONT};font-size:15px;font-weight:600;color:${C.fg};padding-right:8px">Uptime</td>` +
    `<td class="muted" style="vertical-align:middle;font-family:${FONT};font-size:12px;color:${C.muted}">by GenLayer</td>` +
    `</tr></table></a></td></tr>` +
    `<tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.border};border-radius:8px;padding:28px">` +
    label +
    `<h1 class="fg" style="margin:0;font-family:${FONT};font-size:20px;line-height:28px;font-weight:600;color:${C.fg}">${escapeHtml(o.title)}</h1>` +
    o.body +
    `</td></tr>` +
    `<tr><td class="muted" style="padding:16px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.subtle}">` +
    `Testnet beta, not audited. <a href="${escapeHtml(o.unsubscribe)}" target="_blank" class="muted" style="color:${C.subtle};text-decoration:underline">Unsubscribe</a>` +
    `</td></tr></table></td></tr></table></body></html>`
  );
}

function textFooter(unsub: string): string {
  return `--
GenLayer Uptime: testnet beta, NOT AUDITED.
Unsubscribe: ${unsub}
`;
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
  const subject = `[Uptime] Job failed: ${name}`;
  const text =
    `Your Uptime job "${name}" failed on ${network}: ${reason}.\n\n` +
    `Job: ${jobId}\nRun: ${runId}\n\n` +
    `Open the job: ${links.dashboard}\n\n` +
    `Repeated failures are rate-limited, so you may not get an email for every failed run.\n\n` +
    textFooter(links.unsubscribe);
  const html = frame({
    title: name,
    label: { text: "Job failed", tone: "danger" },
    body:
      para(`${escapeHtml(network)}: ${escapeHtml(reason)}.`) +
      para(`Run ${mono(runId)}`, `font-size:12px;color:${C.subtle}`) +
      button(links.dashboard, "Open job"),
    unsubscribe: links.unsubscribe,
  });
  return { to, subject, text, html, headers: listHeaders(links.unsubscribe) };
}

export function verificationMessage(
  to: string,
  wallet: string,
  links: { confirm: string; unsubscribe: string }
): Message {
  const subject = "[Uptime] Confirm this address for job alerts";
  const text =
    `The wallet ${wallet} asked to send GenLayer Uptime job alerts to this address.\n\n` +
    `Confirm (link valid for 24 hours): ${links.confirm}\n\n` +
    `If you did not ask for this, ignore this email: nothing is sent until the address is confirmed.\n\n` +
    textFooter(links.unsubscribe);
  const html = frame({
    title: "Confirm your email",
    body:
      para(`Wallet ${mono(shortWallet(wallet))} wants Uptime job alerts sent here.`) +
      button(links.confirm, "Confirm address") +
      para("Link valid 24 hours. Didn\u2019t ask? Ignore this email.", `margin-top:20px;font-size:12px;line-height:18px;color:${C.subtle}`),
    unsubscribe: links.unsubscribe,
  });
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
  const subject = `[Uptime] Job recovered: ${name}`;
  const text =
    `Your Uptime job "${name}" passed again on ${network}.\n\n` +
    `Job: ${jobId}\nRun: ${runId}\n\n` +
    `Open the job: ${links.dashboard}\n\n` +
    textFooter(links.unsubscribe);
  const html = frame({
    title: name,
    label: { text: "Recovered", tone: "success" },
    body:
      para(`Passing again on ${escapeHtml(network)}.`) +
      para(`Run ${mono(runId)}`, `font-size:12px;color:${C.subtle}`) +
      button(links.dashboard, "Open job"),
    unsubscribe: links.unsubscribe,
  });
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
  const subject = `[Uptime] Daily digest: ${name}`;
  const counts = `${s.total} runs: ${s.passed} passed, ${s.failed} failed${s.pending ? `, ${s.pending} still running` : ""} (pass rate ${rate}).`;
  const last = s.lastFailure ? `Last failure: ${s.lastFailure.reason}${s.lastFailure.at ? ` at ${s.lastFailure.at.replace("T", " ").slice(0, 16)} UTC` : ""}.` : "No failures.";
  const text =
    `Your Uptime job "${name}" on ${network}, last 24 hours:\n\n${counts}\n${last}\n\n` +
    `Open the job: ${links.dashboard}\n\n` +
    textFooter(links.unsubscribe);
  const stat = (n: string, l: string, color: string) =>
    `<td width="33%" style="padding:12px 0;text-align:center;font-family:${FONT}">` +
    `<div class="fg" style="font-size:20px;line-height:26px;font-weight:600;color:${color}">${escapeHtml(n)}</div>` +
    `<div class="muted" style="font-size:12px;line-height:16px;color:${C.muted}">${escapeHtml(l)}</div></td>`;
  const html = frame({
    title: name,
    label: { text: "Last 24 hours", tone: "muted" },
    body:
      para(escapeHtml(network)) +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border-top:1px solid ${C.border};border-bottom:1px solid ${C.border}"><tr>` +
      stat(String(s.passed), "passed", C.fg) +
      stat(String(s.failed), "failed", s.failed ? TONE.danger : C.fg) +
      stat(rate, "pass rate", C.fg) +
      `</tr></table>` +
      para(escapeHtml(last), `margin-top:12px;font-size:12px;line-height:18px;color:${C.subtle}`) +
      button(links.dashboard, "Open job"),
    unsubscribe: links.unsubscribe,
  });
  return { to, subject, text, html, headers: listHeaders(links.unsubscribe) };
}
