"use client";

import { useEffect, useState } from "react";
import { ago } from "./verdict";

/** Relative time, computed in the browser so a cached page never shows a stale "3 min ago". */
export function Ago({ sec }: { sec: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  const iso = new Date(sec * 1000).toISOString();
  return (
    <time dateTime={iso} title={new Date(sec * 1000).toUTCString()}>
      {now == null ? `at ${iso.slice(11, 16)} UTC` : ago(sec, now)}
    </time>
  );
}
