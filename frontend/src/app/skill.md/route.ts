import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  const skillPath = join(process.cwd(), "..", "contracts", "SKILL.md");

  try {
    const content = readFileSync(skillPath, "utf-8");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch {
    // Fallback: serve from a hardcoded copy if file read fails (e.g. on Vercel)
    const fallbackUrl =
      "https://raw.githubusercontent.com/genlayer-foundation/uptime/main/contracts/SKILL.md";
    const res = await fetch(fallbackUrl);
    const text = await res.text();
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }
}
