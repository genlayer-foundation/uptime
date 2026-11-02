// One pg Pool per server instance, from DATABASE_URL (Neon via the Vercel
// Marketplace in production, a local Postgres in dev — see README). Neon's URL
// carries sslmode=require, which pg honours on its own.
import { Pool } from "pg";

let pool: Pool | null = null;

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not configured");
    // Serverless: keep the pool small; each function instance holds its own.
    pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000 });
  }
  return pool;
}
