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

export interface PageOptions {
  /** Renders a POST button back to the same URL. */
  form?: { label: string };
  /** Result state after a POST: a check or a cross above the title. */
  tone?: "success" | "error";
  /** A follow-up link (our own fixed paths only). */
  link?: { href: string; label: string };
}

// The Uptime look (src/app/globals.css tokens, the Header's pulse mark, the
// primary Button), inlined: these pages are raw Responses, outside the app shell.
const PAGE_CSS =
  `:root{color-scheme:light}*{box-sizing:border-box}` +
  `body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:48px 16px;` +
  `background:#fafafa;color:#18181b;font:14px/1.5 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}` +
  `a{color:inherit}` +
  `.brand{display:flex;align-items:center;gap:10px;text-decoration:none}` +
  `.brand svg{width:20px;height:20px;color:#9b6af6}` +
  `.brand b{font-size:15px;font-weight:600;letter-spacing:-.01em}.brand span{font-size:12px;color:#71717a}` +
  `.card{width:100%;max-width:400px;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:32px;text-align:center}` +
  `.icon{width:40px;height:40px;margin:0 auto 16px;border-radius:999px;display:flex;align-items:center;justify-content:center}` +
  `.icon svg{width:20px;height:20px}` +
  `.ok{background:#ecfdf5;color:#059669;border:1px solid #a7f3d0}.err{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}` +
  `h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}` +
  `p{margin:8px 0 0;color:#71717a}` +
  `form,.next{margin-top:24px}` +
  `.btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 16px;border:0;border-radius:8px;` +
  `background:#18181b;color:#fff;font:500 14px "DM Sans",system-ui,sans-serif;text-decoration:none;cursor:pointer;transition:background .15s}` +
  `.btn:hover{background:#27272a}.btn:focus-visible{outline:2px solid #9b6af6;outline-offset:2px}` +
  `.back{font-size:12px;color:#a1a1aa;text-decoration:none}.back:hover{color:#18181b}`;

const MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

/** A fixed, branded HTML page. Every caller-supplied string is escaped. */
export function page(title: string, body: string, opts: PageOptions = {}): Response {
  const icon =
    opts.tone === "success" ? `<div class="icon ok">${CHECK}</div>` : opts.tone === "error" ? `<div class="icon err">${CROSS}</div>` : "";
  const action = opts.form
    ? `<form method="post"><button type="submit" class="btn">${escapeHtml(opts.form.label)}</button></form>`
    : opts.link
      ? `<div class="next"><a class="btn" href="${escapeHtml(opts.link.href)}">${escapeHtml(opts.link.label)}</a></div>`
      : "";
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><meta name="color-scheme" content="light"><title>${escapeHtml(title)} | Uptime by GenLayer</title>` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap">` +
    `<style>${PAGE_CSS}</style></head><body>` +
    `<a class="brand" href="/">${MARK}<b>Uptime</b><span>by GenLayer</span></a>` +
    `<main class="card">${icon}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${action}</main>` +
    `<a class="back" href="/">uptime.genlayer.foundation</a></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      // Only loosened for the DM Sans webfont (Google Fonts CSS + font files).
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
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
