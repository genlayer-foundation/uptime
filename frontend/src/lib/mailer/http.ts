// Small helpers for the /api/alerts/** routes.

import { NextResponse } from "next/server";
import { ensureMailerWired } from "@/lib/jobs/mailerWiring";
import { readConfig } from "./config";
import type { MailerDeps } from "./policy";
import { mailerDeps } from "./runtime";
import { escapeHtml } from "./templates";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Deps, or the 503 that every alerts route answers while the mailer is off or unwired. */
export function depsOr503(): MailerDeps | NextResponse {
  if (!readConfig().enabled) return json({ error: "email alerts are not enabled" }, 503);
  // Wire here, not only in instrumentation.ts: on Vercel the instrumentation hook
  // is a separate bundle, so its configureMailer() sets a DIFFERENT copy of the
  // runtime module than the one this route reads. Idempotent per instance.
  ensureMailerWired();
  const deps = mailerDeps();
  return deps ?? json({ error: "email alerts are not enabled" }, 503);
}

/** A minimal, fixed HTML page. `form` renders a POST button back to the same URL. */
export function page(title: string, body: string, form?: { label: string }): Response {
  const button = form
    ? `<form method="post"><button type="submit" style="font:inherit;padding:8px 16px;cursor:pointer">${escapeHtml(form.label)}</button></form>`
    : "";
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>` +
    `<body style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;color:#111">` +
    `<h1 style="font-size:20px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${button}</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      "X-Frame-Options": "DENY",
    },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const v = await request.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
