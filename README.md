# Uptime — GenLayer SLA Monitor

Trustless uptime monitoring for GenLayer infrastructure services. Health checks run on-chain via an Intelligent Contract; a public dashboard shows real-time status, uptime percentages, and SLA compliance.

**Live:** https://uptime.dev.genlayer.foundation

## What it monitors

- ZKSync Bridge explorer
- Studionet RPC + Explorer
- Asimov RPC + Explorer
- Bradbury RPC + Explorer

## How it works

1. A **Vercel cron job** calls the Intelligent Contract's `run_checks()` method at a configurable interval
2. The contract pings each service (JSON-RPC `gen_dbg_ping` for RPCs, HTTP GET for explorers) with validator consensus via `gl.eq_principle.strict_eq()`
3. Every check result is stored **on-chain** — trustless SLA proof
4. An off-chain cache (Vercel KV) syncs incrementally for fast dashboard loading
5. The public dashboard shows current status, uptime %, historical charts, and SLA compliance

The contract is deployed on **studionet**, **asimov**, and **bradbury**.

## Setup

### Prerequisites

- Node.js 20+
- GenLayer CLI (`npm i -g genlayer`)
- Claude Code with GenLayer skills:
  ```bash
  claude mcp add -s user genlayer-skills -- npx -y @anthropic-ai/claude-code-mcp@latest --skill-url https://skills.genlayer.com/
  ```

### Contract

```bash
# Write/validate
/write-contract    # in Claude Code
/genvm-lint        # validate

# Test
/direct-tests      # unit tests
/integration-tests # network tests

# Deploy to all 3 networks
/genlayer-cli
```

### Frontend

```bash
cd frontend
cp .env.example .env.local  # fill in contract addresses + KV credentials
npm install
npm run dev
```

### Deploy

Push to GitHub → Vercel auto-deploys. Configure domain `uptime.dev.genlayer.foundation` in Vercel.

## Tech Stack

- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4
- **UI:** Radix UI + Lucide icons, GenLayer dark theme
- **Data:** TanStack Query + Vercel KV cache
- **Web3:** genlayer-js SDK
- **Contract:** Python GenLayer Intelligent Contract
- **Hosting:** Vercel

## Organization

- **GitHub:** [genlayer-foundation](https://github.com/genlayer-foundation)
- **See also:** [GENLAYER_DEVELOPMENT.md](../GENLAYER_DEVELOPMENT.md) for cross-project patterns
