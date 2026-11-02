// Ids. Jobs and runs are UUIDs (text), the same string the API returns, so
// other tables (e.g. 010_alerts.alert_rules.job_id) can reference them.
//
// A job's Bradbury pool id (UptimePool `bytes32 uptimeId`) is the job UUID's
// 16 bytes, left-padded with zeros to 32 bytes:
//   job 1b4e28ba-2fa1-41d2-883f-0016d3cca427
//   pool 0x000000000000000000000000000000001b4e28ba2fa141d2883f0016d3cca427
// Pool ids are first-come on-chain: anyone who learns a job id can create a
// pool under it first. That can block the job (the scheduler refuses a pool
// whose owner is not the job's owner) but never move the owner's funds.

import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newId(): string {
  return randomUUID();
}

export function isId(v: string): boolean {
  return UUID.test(v);
}

export function poolIdFor(jobId: string): `0x${string}` {
  if (!isId(jobId)) throw new Error("not a job id");
  return `0x${"0".repeat(32)}${jobId.replaceAll("-", "")}`;
}

export function jobIdFromPool(poolId: string): string | null {
  const m = /^0x0{32}([0-9a-f]{32})$/.exec(poolId.toLowerCase());
  if (!m) return null;
  const h = m[1];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
