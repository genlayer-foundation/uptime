"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Alert, Badge, Button, Card, CardBody, CardGrid, CardHeader, Field, Input, Stat } from "@/components/ui";
import { JOBS_MOCK } from "@/lib/jobs/client";
import { MoneyNotice } from "./ui";
import { gen, shortHex } from "./format";
import { depositPool, ensurePoolConfig, parseGen, poolContract, readPool, setPoolPaused, topUpPool, withdrawPool, type PoolInfo } from "./pool";

type Busy = null | "topup" | "withdraw" | "pause" | "deposit";

/** Balance + owner actions for a job's UptimePool. Every write is signed by the viewer's wallet. */
export function PoolPanel({ poolId, isOwner, wallet }: { poolId: string; isOwner: boolean; wallet: string | null }) {
  const id = useId();
  const [pool, setPool] = useState<PoolInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [topUp, setTopUp] = useState("1");
  const [withdraw, setWithdraw] = useState("");
  const [dep, setDep] = useState({ amount: "1", perRun: "0.01", perDay: "0.5" });
  const [address, setAddress] = useState(poolContract());
  useEffect(() => {
    void ensurePoolConfig().then((c) => setAddress(c.address));
  }, []);

  const load = useCallback(async () => {
    try {
      setPool(await readPool(poolId));
      setError(null);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).split("\n")[0]);
      setPool(null);
    }
  }, [poolId]);

  useEffect(() => {
    if (!address) return;
     
    void load();
  }, [address, load]);

  async function act(kind: Exclude<Busy, null>, fn: () => Promise<{ hash: string }>, done: string) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const { hash } = await fn();
      setNotice(hash === "mock" ? `${done} (simulated by the mock, no transaction sent).` : `${done}. Tx ${shortHex(hash)}.`);
      await load();
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0];
      setError(/rejected|denied/i.test(msg) ? "The wallet request was rejected." : msg);
    } finally {
      setBusy(null);
    }
  }

  const ownerMismatch = pool && wallet && pool.owner.toLowerCase() !== wallet.toLowerCase();
  const canAct = isOwner && !!pool && !ownerMismatch;

  return (
    <Card>
      <CardHeader
        title="Pool"
        subtitle={
          <span className="break-all font-mono">
            GEN pool on GenLayer Testnet Bradbury{address ? ` ${shortHex(address, 4)}` : ""} · id {shortHex(poolId, 6)}
          </span>
        }
        actions={<MoneyNotice />}
      />
      <CardBody className="grid gap-5">
        {!address ? (
          <Alert tone="warn" title="Funding is not available yet">
            GEN pools on GenLayer Testnet Bradbury are not switched on yet, so this job is unfunded and does not run until funding is available.
          </Alert>
        ) : pool === undefined ? (
          <p className="text-sm text-muted">Reading the pool…</p>
        ) : pool === null ? (
          <div className="grid gap-4">
            <Alert tone="warn" title="No pool yet">
              Nobody has deposited to this id. The scheduler will not run this job until its owner funds it.
            </Alert>
            {isOwner && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Deposit (GEN)" htmlFor={`${id}-a`}>
                    <Input id={`${id}-a`} className="font-mono" value={dep.amount} onChange={(e) => setDep({ ...dep, amount: e.target.value })} />
                  </Field>
                  <Field label="Cap per run (GEN)" htmlFor={`${id}-r`}>
                    <Input id={`${id}-r`} className="font-mono" value={dep.perRun} onChange={(e) => setDep({ ...dep, perRun: e.target.value })} />
                  </Field>
                  <Field label="Cap per day (GEN)" htmlFor={`${id}-d`}>
                    <Input id={`${id}-d`} className="font-mono" value={dep.perDay} onChange={(e) => setDep({ ...dep, perDay: e.target.value })} />
                  </Field>
                </div>
                <div>
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      act(
                        "deposit",
                        () => depositPool(poolId, parseGen(dep.amount), { perRunWei: parseGen(dep.perRun), perDayWei: parseGen(dep.perDay) }, wallet ?? undefined),
                        "Pool created",
                      )
                    }
                  >
                    {busy === "deposit" ? "Confirm in your wallet…" : "Create pool & deposit"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <CardGrid className="grid-cols-1 sm:grid-cols-3">
              <Stat label="Balance" value={gen(pool.balanceWei)} sub={pool.paused ? "charges paused" : "charges allowed"} />
              <Stat label="Scheduler can draw now" value={gen(pool.availableToSchedulerWei)} sub="one charge, after every cap" />
              <Stat
                label="Caps"
                value={pool.perRunWei != null ? gen(pool.perRunWei) : "—"}
                sub={pool.perDayWei != null ? `per run · ${gen(pool.perDayWei)} per day` : "per run"}
              />
            </CardGrid>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              Owner <span className="font-mono text-foreground">{shortHex(pool.owner, 4)}</span>
              {pool.paused ? <Badge tone="warn">paused</Badge> : <Badge tone="success">active</Badge>}
              {ownerMismatch && <Badge tone="danger">not your wallet</Badge>}
            </div>

            {canAct && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex items-end gap-2">
                  <Field label="Top up (GEN)" htmlFor={`${id}-t`} className="flex-1">
                    <Input id={`${id}-t`} className="font-mono" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
                  </Field>
                  <Button variant="secondary" disabled={!!busy} onClick={() => act("topup", () => topUpPool(poolId, parseGen(topUp)), "Topped up")}>
                    {busy === "topup" ? "Confirm…" : "Top up"}
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <Field label="Withdraw (GEN, empty = all)" htmlFor={`${id}-w`} className="flex-1">
                    <Input id={`${id}-w`} className="font-mono" placeholder="all" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={!!busy || pool.balanceWei === 0n}
                    onClick={() => act("withdraw", () => withdrawPool(poolId, withdraw.trim() ? parseGen(withdraw) : "all"), "Withdrawn")}
                  >
                    {busy === "withdraw" ? "Confirm…" : "Withdraw"}
                  </Button>
                </div>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <Button variant={pool.paused ? "secondary" : "danger"} disabled={!!busy} onClick={() => act("pause", () => setPoolPaused(poolId, !pool.paused), pool.paused ? "Charges resumed" : "Charges paused")}>
                    {busy === "pause" ? "Confirm…" : pool.paused ? "Resume charges" : "Pause all charges"}
                  </Button>
                  <span className="text-xs text-muted">On-chain kill switch: while paused nobody can charge this pool. Withdraw still works.</span>
                </div>
              </div>
            )}
          </>
        )}
        {notice && <Alert tone="success" title={notice} />}
        {error && (
          <Alert tone="danger" title="Pool call failed">
            {error}
          </Alert>
        )}
        {JOBS_MOCK && <p className="text-xs text-muted">Mock mode: pool calls are simulated in the browser; no wallet transaction is requested.</p>}
      </CardBody>
    </Card>
  );
}
