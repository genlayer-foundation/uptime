# Uptime SLA Monitor

Trustless uptime monitoring for GenLayer infrastructure. An Intelligent Contract stores every health-check result on-chain; a Next.js dashboard displays status, uptime %, charts, and SLA compliance.

**Domain:** `uptime.dev.genlayer.foundation`

## Architecture

```
┌─────────────┐   cron    ┌──────────────────┐   writeContract   ┌─────────────────────┐
│   Vercel    │ ────────► │  Next.js API      │ ────────────────► │  UptimeMonitor.py   │
│   Cron Job  │           │  /api/cron/check  │                   │  (on-chain)         │
└─────────────┘           └──────────────────┘                   └─────────────────────┘
                                                                    │ stores CheckResult
                                                                    ▼
┌─────────────┐  reads    ┌──────────────────┐   incremental     ┌─────────────────────┐
│  Dashboard  │ ◄──────── │  Vercel KV       │ ◄──────────────── │  Contract storage   │
│  (React)    │           │  (off-chain cache)│   sync via read   │  (source of truth)  │
└─────────────┘           └──────────────────┘                   └─────────────────────┘
```

- **On-chain:** Every individual check stored in the Intelligent Contract (trustless SLA proof)
- **Off-chain cache:** Vercel KV (Upstash Redis) syncs incrementally — only fetches new results since last sync, not all history
- **Cron interval:** Configurable (start at 1 min for dev, increase to 1 hour for stable)
- **Contract deployed on:** studionet, asimov, and bradbury (one instance per network)

## Services to Monitor

| Service ID | URL | Check Type |
|-----------|-----|-----------|
| `zksync_bridge` | `https://zksync-os-testnet-genlayer.zksync.dev` | HTTP GET → 200 |
| `studionet_rpc` | `https://studio.genlayer.com/api` | JSON-RPC `gen_dbg_ping` → "pong" |
| `asimov_rpc` | `https://rpc-asimov.genlayer.com` | JSON-RPC `gen_dbg_ping` → "pong" |
| `bradbury_rpc` | `https://rpc-bradbury.genlayer.com` | JSON-RPC `gen_dbg_ping` → "pong" |
| `explorer_studio` | `https://explorer-studio.genlayer.com` | HTTP GET → 200 |
| `explorer_asimov` | `https://explorer-asimov.genlayer.com` | HTTP GET → 200 |
| `explorer_bradbury` | `https://explorer-bradbury.genlayer.com` | HTTP GET → 200 |

ZKSync explorer tx example: https://zksync-os-testnet-genlayer.explorer.zksync.dev/tx/0x8614374194a9ddecc738cc9188a71d8fd0e0923bfca96a4c579715abf502c284

## Metrics per Service

- **Is alive** (yes/no)
- **Blocks behind** (latest block timestamp vs current time — add later)
- More metrics to be added incrementally

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + React 19 + TypeScript (App Router) |
| Styling | Tailwind CSS v4, dark theme |
| Branding | GenLayer purple `#9B6AF6`, fonts: Inter (body) + Space Grotesk (display) |
| UI | Radix UI primitives + Lucide React icons |
| Data fetching | TanStack Query (React Query) |
| Web3 | genlayer-js SDK + Wagmi + Viem |
| Contract | Python — GenLayer Intelligent Contract |
| Hosting | Vercel |
| Cache | Vercel KV (Upstash Redis) |

## Project Structure

```
uptime/
├── contracts/
│   └── uptime_monitor.py        # Intelligent Contract
├── frontend/                     # Next.js App Router
│   ├── src/
│   │   ├── app/                  # Pages & API routes
│   │   │   ├── page.tsx          # Dashboard
│   │   │   └── api/
│   │   │       ├── cron/check/   # Vercel cron → triggers contract
│   │   │       └── sync/         # Incremental cache sync
│   │   ├── components/           # React components
│   │   ├── lib/
│   │   │   ├── genlayer/         # Client setup, WalletProvider
│   │   │   ├── hooks/            # TanStack Query hooks
│   │   │   ├── cache/            # Vercel KV sync logic
│   │   │   └── utils/            # Helpers, toast
│   │   └── styles/
│   ├── .env.local
│   └── vercel.json
├── test/                         # Contract tests
├── CLAUDE.md
└── README.md
```

## Intelligent Contract Design

**Storage:**
```python
@allow_storage
@dataclass
class CheckResult:
    timestamp: u256
    is_up: bool
    extra_data: str

class UptimeMonitor(gl.Contract):
    checks: TreeMap[str, DynArray[CheckResult]]   # service_id → history
    check_count: TreeMap[str, u256]                # service_id → total count
    services: DynArray[str]                        # list of service IDs
```

**Write methods:**
- `run_checks(timestamp: u256)` — iterates all services, does HTTP/RPC checks via `gl.nondet.web.get/post`, uses `gl.eq_principle.strict_eq()` for consensus (factual data), stores each CheckResult

**View methods (with pagination):**
- `get_checks(service_id, offset, limit)` — paginated history
- `get_latest_check(service_id)` — latest check for one service
- `get_all_latest()` — latest check for all services
- `get_check_count(service_id)` — total checks count
- `get_services()` — list all service IDs
- `get_uptime_stats(service_id, last_n)` — uptime % over last N checks

**Check logic:**
- RPC services: POST JSON-RPC `{"method": "gen_dbg_ping", "params": []}` → expect "pong"
- HTTP services: GET URL → expect status 200
- Wrap each in try/except, store `is_up=False` + error on failure

## Off-chain Cache Strategy

The dashboard must NOT read all results from the contract every time. Instead:
1. Vercel KV stores: `last_synced_index:{service_id}` and cached check results
2. Sync endpoint reads `get_check_count()`, compares to last synced index
3. Only fetches new checks via `get_checks(service_id, last_index, new_count - last_index)`
4. Stores new results in KV
5. Dashboard reads from KV (fast)

## Dashboard Features (v1)

- **Current status**: Green/red indicator per service, last check time
- **Uptime %**: 24h, 7d, 30d per service
- **Historical charts**: Uptime over time (line/area charts)
- **SLA compliance**: Target vs actual (e.g., 99.5% target)
- **Public**: No authentication required

## Environment Variables

```bash
# Contract addresses (one per network)
NEXT_PUBLIC_CONTRACT_STUDIONET=0x...
NEXT_PUBLIC_CONTRACT_ASIMOV=0x...
NEXT_PUBLIC_CONTRACT_BRADBURY=0x...

# RPC endpoints
NEXT_PUBLIC_STUDIONET_RPC=https://studio.genlayer.com/api
NEXT_PUBLIC_ASIMOV_RPC=https://rpc-asimov.genlayer.com
NEXT_PUBLIC_BRADBURY_RPC=https://rpc-bradbury.genlayer.com

# Server-side wallet for cron job
PRIVATE_KEY=0x...

# Vercel KV (Upstash Redis)
KV_REST_API_URL=
KV_REST_API_TOKEN=

# Cron interval
CRON_INTERVAL_MINUTES=1
```

## Vercel Cron Config

In `vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/check", "schedule": "* * * * *" }]
}
```

## Development Workflow

1. Install GenLayer skills: see README
2. Write contract with `/write-contract`, validate with `/genvm-lint`
3. Test with `/direct-tests`, then `/integration-tests`
4. Deploy contract to all 3 networks with `/genlayer-cli`
5. Scaffold frontend: `npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --use-npm`
6. Install deps: `genlayer-js`, `@tanstack/react-query`, `@radix-ui/*`, `lucide-react`, `@vercel/kv`, `wagmi`, `viem`
7. Build dashboard components
8. Deploy to Vercel, configure domain `uptime.dev.genlayer.foundation`

## Claude Code Skills

Use these skills (already installed globally via `https://skills.genlayer.com/`):

- `/write-contract` — write/modify the Intelligent Contract
- `/genvm-lint` — validate contract against GenVM rules
- `/direct-tests` — fast unit tests for the contract
- `/integration-tests` — full integration tests against a network
- `/genlayer-cli` — deploy and interact with contracts

Also use frontend design skills for GenLayer branding/colors.

## GenLayer Network Reference

| Network | RPC | Explorer | Chain ID |
|---------|-----|----------|----------|
| Studionet | `https://studio.genlayer.com/api` | https://explorer-studio.genlayer.com | 61999 |
| Asimov | `https://rpc-asimov.genlayer.com` | https://explorer-asimov.genlayer.com | 4221 |
| Bradbury | `https://rpc-bradbury.genlayer.com` | https://explorer-bradbury.genlayer.com | 4221 |
| ZKSync | `https://zksync-os-testnet-genlayer.zksync.dev` | https://zksync-os-testnet-genlayer.explorer.zksync.dev | — |

Health check: `GET :9153/health` → `{"status": "up"|"down"}`
Ping: JSON-RPC `gen_dbg_ping` → `"pong"`
