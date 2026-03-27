# Deploy an SLA Agreement Contract

Step-by-step instructions for deploying an SLA Agreement on GenLayer. This guide is designed for AI agents but works for humans too.

## Prerequisites

- GenLayer CLI installed: `npm install -g genlayer`
- Network set to Studionet: `genlayer network set studionet`
- An account created: `genlayer account create --name my-account --password ""`
- Studionet does NOT require GEN tokens. Transactions are free.

## Architecture

```
UptimeMonitor (existing)     Stores health check results
       |
       v
SLA Verifier (existing)      Verifies uptime claims, calculates penalties
       |                     Takes 10% protocol fee on penalties
       v
SLA Agreement (you deploy)   Your custom agreement between two parties
```

You only need to deploy an **SLA Agreement**. The Verifier and UptimeMonitor are already deployed.

## Deployed Contract Addresses (Studionet)

| Contract | Address |
|----------|---------|
| UptimeMonitor | `0x1AE5Eb9a7A1ece2E873689e0ED33b818dd2f2573` |
| SLA Verifier | `0x8D926888B6781d9C987dB89693E771D702366D85` |

## Step 1: Deploy

```bash
genlayer deploy \
  --contract contracts/sla_agreement.py \
  --args \
    "MY-SLA-001" \
    "Customer Name" \
    "Provider Name" \
    "0xCUSTOMER_ADDRESS" \
    "0xPROVIDER_ADDRESS" \
    "0x8D926888B6781d9C987dB89693E771D702366D85" \
    "0x1AE5Eb9a7A1ece2E873689e0ED33b818dd2f2573" \
    '["studionet_rpc","asimov_rpc"]' \
    9950 \
    "tiered" \
    "monthly" \
    5000 \
    55000 \
    1711929600 \
    0
```

### Constructor Arguments

| # | Argument | Type | Description |
|---|----------|------|-------------|
| 1 | `agreement_id` | string | Unique identifier, e.g. "MY-SLA-001" |
| 2 | `customer_name` | string | Name of the party paying for the service |
| 3 | `provider_name` | string | Name of the party providing the service |
| 4 | `customer_address` | Address | Wallet address of the customer |
| 5 | `provider_address` | Address | Wallet address of the provider |
| 6 | `sla_verifier_address` | Address | Use `0x8D926888B6781d9C987dB89693E771D702366D85` |
| 7 | `uptime_monitor_address` | Address | Use `0x1AE5Eb9a7A1ece2E873689e0ED33b818dd2f2573` |
| 8 | `service_ids_json` | string | JSON array of service IDs to monitor |
| 9 | `target_uptime_bps` | u256 | Target uptime in basis points (9950 = 99.50%) |
| 10 | `penalty_model` | string | One of: "linear", "tiered", "full" |
| 11 | `payment_schedule` | string | "monthly" or "yearly" |
| 12 | `base_payment_monthly` | u256 | Monthly payment amount |
| 13 | `base_payment_yearly` | u256 | Yearly payment amount |
| 14 | `effective_from` | u256 | Unix timestamp for start date |
| 15 | `effective_until` | u256 | Unix timestamp for end date (0 = no end) |

### Available Service IDs

| Service ID | Description |
|-----------|-------------|
| `zksync_bridge` | ZKSync bridge to settlement layer |
| `studionet_rpc` | Studionet dev network RPC |
| `asimov_rpc` | Asimov testnet RPC |
| `bradbury_rpc` | Bradbury testnet RPC |
| `explorer_studio` | Studionet block explorer |
| `explorer_asimov` | Asimov block explorer |
| `explorer_bradbury` | Bradbury block explorer |

### Penalty Models

| Model | Behavior |
|-------|----------|
| `linear` | Penalty proportional to shortfall: `payment * shortfall / target` |
| `tiered` | Brackets: <0.50% shortfall = 10%, 0.50-2% = 25%, 2-5% = 50%, >5% = 100% |
| `full` | Any breach = full payment withheld |

## Step 2: Verify Deployment

```bash
# Get the receipt (wait for finalization)
genlayer receipt <TX_HASH>

# Read the contract terms
genlayer call <CONTRACT_ADDRESS> get_terms

# Check current compliance (last 24 checks)
genlayer call <CONTRACT_ADDRESS> check_compliance --args 24
```

## Step 3: Settle a Period

```bash
# Settle with the last 720 checks (30 days at 1/hour)
genlayer write <CONTRACT_ADDRESS> settle_period \
  --args 1711929600 1714521600 720
```

Arguments: `period_start`, `period_end` (unix timestamps), `checks_to_evaluate`.

## Step 4: Dispute via Internet Court

If either party disagrees with the settlement, they can open a case at [internetcourt.org](https://internetcourt.org).

The contract exposes `internet_court_summary()` which returns everything a jury needs:
- Full agreement terms
- Settlement history
- Instructions for verifying compliance

```bash
# Get the summary an Internet Court jury would read
genlayer call <CONTRACT_ADDRESS> internet_court_summary
```

### Example Internet Court Statement

> "Provider failed to maintain 99.50% uptime on service X during March 2026,
> as defined in SLA Agreement deployed at 0xCONTRACT on Studionet."

### Guidelines for Jury

1. Call `check_compliance(720)` on the SLA Agreement contract
2. Read `internet_court_summary()` for full terms and history
3. Verdict is TRUE (breach occurred) if any covered service measured below target

## Example: Two Live Agreements

### SLA-001: GenLayer Labs pays Matter Labs

```bash
genlayer call 0x2A3139E97262F25DFd0B039D55cdD99c1C192B36 get_terms
```

- Services: ZKSync Bridge
- Target: 99.50%
- Payment: 5,000/month
- Penalty: Tiered

### SLA-002: GenLayer Foundation pays GenLayer Labs

```bash
genlayer call 0x90287aec8e7028EF57Ad58fb9060a7Bdb3D5d548 get_terms
```

- Services: All RPCs + Explorers
- Target: 99.90%
- Payment: 110,000/year
- Penalty: Linear

## Source Code

- [sla_agreement.py](https://github.com/genlayer-foundation/uptime/blob/main/contracts/sla_agreement.py)
- [sla_verifier.py](https://github.com/genlayer-foundation/uptime/blob/main/contracts/sla_verifier.py)
- [uptime_monitor.py](https://github.com/genlayer-foundation/uptime/blob/main/contracts/uptime_monitor.py)
