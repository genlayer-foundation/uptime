# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

from genlayer import *
from dataclasses import dataclass


@allow_storage
@dataclass
class VerificationResult:
    agreement_id: str
    period_start: u256
    period_end: u256
    measured_uptime_bps: u256  # basis points (9950 = 99.50%)
    target_uptime_bps: u256
    sla_met: bool
    penalty_amount: u256  # in smallest token unit
    timestamp: u256


class SlaVerifier(gl.Contract):
    """
    Base SLA verification contract. Reads uptime data from the
    UptimeMonitor contract and determines whether an SLA was met.

    Other SLA agreement contracts call this to verify claims.
    A 10% protocol fee is applied to all penalty settlements.
    """

    uptime_monitor: Address
    owner: Address
    fee_recipient: Address
    protocol_fee_bps: u256  # basis points, e.g. 1000 = 10%
    verifications: TreeMap[str, VerificationResult]
    verification_count: u256

    def __init__(self, uptime_monitor_address: Address, fee_recipient: Address):
        self.uptime_monitor = uptime_monitor_address
        self.owner = gl.message.sender_account
        self.fee_recipient = fee_recipient
        self.protocol_fee_bps = u256(1000)  # 10%
        self.verification_count = u256(0)

    @gl.public.view
    def verify_uptime(
        self,
        service_id: str,
        last_n_checks: u256,
        target_uptime_bps: u256,
    ) -> dict:
        """
        Reads the UptimeMonitor contract and checks if a service
        met the target uptime over the last N checks.
        Returns the measured uptime and whether the SLA was met.
        """
        monitor = gl.ContractAt(self.uptime_monitor)
        stats = monitor.view().get_uptime_stats(service_id, last_n_checks)

        measured = int(stats["uptime_pct"])
        target = int(target_uptime_bps)
        sla_met = measured >= target

        return {
            "service_id": service_id,
            "checks_evaluated": int(stats["total"]),
            "checks_up": int(stats["up"]),
            "measured_uptime_bps": measured,
            "target_uptime_bps": target,
            "sla_met": sla_met,
            "shortfall_bps": max(0, target - measured),
        }

    @gl.public.view
    def calculate_penalty(
        self,
        base_payment: u256,
        measured_uptime_bps: u256,
        target_uptime_bps: u256,
        penalty_model: str,
    ) -> dict:
        """
        Calculate penalty amount based on the penalty model.

        Models:
        - "linear": penalty scales linearly with shortfall
        - "tiered": fixed tiers (minor/major/critical breach)
        - "full": full payment withheld on any breach
        """
        measured = int(measured_uptime_bps)
        target = int(target_uptime_bps)
        payment = int(base_payment)

        if measured >= target:
            return {
                "penalty": 0,
                "payout": payment,
                "protocol_fee": 0,
                "model": penalty_model,
            }

        shortfall = target - measured

        if penalty_model == "linear":
            # Penalty proportional to shortfall
            # e.g. target 9950, measured 9900 => shortfall 50
            # penalty = payment * shortfall / target
            penalty = (payment * shortfall) // target

        elif penalty_model == "tiered":
            # Tiers:
            # < 50 bps shortfall (e.g. 99.50 -> 99.00): 10% penalty
            # 50-200 bps shortfall (99.00 -> 97.50): 25% penalty
            # 200-500 bps shortfall (97.50 -> 95.00): 50% penalty
            # > 500 bps shortfall (< 95.00): 100% penalty
            if shortfall <= 50:
                penalty = payment // 10
            elif shortfall <= 200:
                penalty = payment // 4
            elif shortfall <= 500:
                penalty = payment // 2
            else:
                penalty = payment

        elif penalty_model == "full":
            # Any breach = full payment withheld
            penalty = payment

        else:
            penalty = 0

        # Apply protocol fee (10% of penalty)
        fee_bps = int(self.protocol_fee_bps)
        protocol_fee = (penalty * fee_bps) // 10000
        payout = payment - penalty

        return {
            "penalty": penalty,
            "payout": max(0, payout),
            "protocol_fee": protocol_fee,
            "model": penalty_model,
        }

    @gl.public.write
    def record_verification(
        self,
        agreement_id: str,
        service_id: str,
        period_start: u256,
        period_end: u256,
        last_n_checks: u256,
        target_uptime_bps: u256,
        base_payment: u256,
        penalty_model: str,
    ) -> dict:
        """
        Perform a full verification: read uptime, calculate penalty,
        and store the result on-chain.
        """
        # Verify uptime
        verification = self.verify_uptime(
            service_id, last_n_checks, target_uptime_bps
        )
        measured = verification["measured_uptime_bps"]
        sla_met = verification["sla_met"]

        # Calculate penalty
        penalty_result = self.calculate_penalty(
            base_payment,
            u256(measured),
            target_uptime_bps,
            penalty_model,
        )

        # Store result
        idx = int(self.verification_count)
        key = str(idx)
        self.verifications[key] = VerificationResult(
            agreement_id=agreement_id,
            period_start=period_start,
            period_end=period_end,
            measured_uptime_bps=u256(measured),
            target_uptime_bps=target_uptime_bps,
            sla_met=sla_met,
            penalty_amount=u256(penalty_result["penalty"]),
            timestamp=u256(int(gl.block.timestamp)),
        )
        self.verification_count = u256(idx + 1)

        return {
            "verification_id": idx,
            "agreement_id": agreement_id,
            "service_id": service_id,
            "measured_uptime_bps": measured,
            "target_uptime_bps": int(target_uptime_bps),
            "sla_met": sla_met,
            "penalty": penalty_result["penalty"],
            "payout": penalty_result["payout"],
            "protocol_fee": penalty_result["protocol_fee"],
        }

    @gl.public.view
    def get_verification(self, verification_id: u256) -> dict:
        key = str(int(verification_id))
        v = self.verifications[key]
        return {
            "agreement_id": v.agreement_id,
            "period_start": int(v.period_start),
            "period_end": int(v.period_end),
            "measured_uptime_bps": int(v.measured_uptime_bps),
            "target_uptime_bps": int(v.target_uptime_bps),
            "sla_met": v.sla_met,
            "penalty_amount": int(v.penalty_amount),
            "timestamp": int(v.timestamp),
        }

    @gl.public.view
    def get_verification_count(self) -> u256:
        return self.verification_count

    @gl.public.view
    def get_protocol_fee_bps(self) -> u256:
        return self.protocol_fee_bps

    @gl.public.view
    def get_uptime_monitor(self) -> Address:
        return self.uptime_monitor
