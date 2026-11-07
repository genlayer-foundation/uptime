"use client";

// Community pools (UptimePool v2, on only when UPTIME_POOL_V2_BRADBURY is set):
// one "Back this job" button and one compact line of backers. Any wallet adds
// GEN to the job's Budget; runs draw from every backer pro-rata, and each
// backer can take back their own unspent share at any time.

import { useCallback, useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { backJob, parseGen, readBacking, withdrawMyShare, type Backing } from "./pool";
import { gen, shortHex } from "./format";

const SHOWN = 5;

export function Backers({ poolId, wallet }: { poolId: string; wallet: string | null }) {
  const [b, setB] = useState<Backing | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    readBacking(poolId, wallet).then(setB, () => setB(null));
  }, [poolId, wallet]);
  useEffect(load, [load]);

  if (!b) return null;

  async function act(fn: () => Promise<{ hash: string }>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ bad: false, text: done });
      setOpen(false);
      load();
    } catch (e) {
      const m = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      setMsg({ bad: true, text: /rejected|denied/i.test(m) ? "The wallet request was rejected." : m });
    } finally {
      setBusy(false);
    }
  }

  const people = b.backers === 1 ? "1 person" : `${b.backers} people`;
  const rest = b.list.length - SHOWN;

  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {open ? (
          <>
            <Input aria-label="GEN to add" className="h-8 w-24 font-mono text-xs" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Button size="sm" disabled={busy} onClick={() => act(() => backJob(poolId, parseGen(amount)), "Thanks, your GEN backs this job.")}>
              {busy ? "Confirm…" : "Send GEN"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <HandCoins className="h-3.5 w-3.5" aria-hidden /> Back this job
          </Button>
        )}
        <span className="text-muted">
          Backed by {people} · {gen(b.balanceWei)}
        </span>
        {b.mineWei > 0n && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => withdrawMyShare(poolId), "Your share is back in your wallet.")}>
            Withdraw my {gen(b.mineWei)}
          </Button>
        )}
      </div>
      {b.list.length > 0 && (
        <p className="text-xs text-muted">
          {b.list.slice(0, SHOWN).map((x, i) => (
            <span key={x.who}>
              {i > 0 && " · "}
              <span className="font-mono">{shortHex(x.who, 4)}</span> {gen(x.wei)}
            </span>
          ))}
          {rest > 0 && ` · +${rest} more`}
        </p>
      )}
      {msg && <p className={`text-xs ${msg.bad ? "text-danger-fg" : "text-muted"}`}>{msg.text}</p>}
    </div>
  );
}
