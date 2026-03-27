# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

from genlayer import *
from dataclasses import dataclass


@allow_storage
@dataclass
class PeriodSettlement:
    period_start: u256
    period_end: u256
    measured_uptime_bps: u256
    target_uptime_bps: u256
    sla_met: bool
    base_payment: u256
    penalty_applied: u256
    net_payout: u256
    settled_at: u256
    settled_by: str  # "auto" or "internet_court"


class SlaAgreement(gl.Contract):
    """
    An SLA agreement between a customer and a provider.

    The customer pays the provider for maintaining uptime on specific
    services. If the provider misses the target, penalties are applied.

    This contract can be read by Internet Court to settle disputes.

    Example agreements:
    - GenLayer Labs pays Matter Labs for ZKSync bridge uptime
    - GenLayer Foundation pays GenLayer Labs for RPC/Explorer uptime
    """

    # Parties
    customer_name: str
    provider_name: str
    customer_address: Address
    provider_address: Address

    # References
    sla_verifier: Address
    uptime_monitor: Address

    # Agreement terms
    agreement_id: str
    service_ids: DynArray[str]  # which services are covered
    target_uptime_bps: u256  # e.g. 9950 = 99.50%
    penalty_model: str  # "linear", "tiered", "full"
    payment_schedule: str  # "monthly" or "yearly"
    base_payment_monthly: u256  # monthly payment amount
    base_payment_yearly: u256  # yearly payment amount (can differ from 12x monthly)

    # Settlement history
    settlements: TreeMap[str, PeriodSettlement]
    settlement_count: u256

    # State
    active: bool
    created_at: u256
    effective_from: u256
    effective_until: u256  # 0 = no end date

    def __init__(
        self,
        agreement_id: str,
        customer_name: str,
        provider_name: str,
        customer_address: Address,
        provider_address: Address,
        sla_verifier_address: Address,
        uptime_monitor_address: Address,
        service_ids_json: str,
        target_uptime_bps: u256,
        penalty_model: str,
        payment_schedule: str,
        base_payment_monthly: u256,
        base_payment_yearly: u256,
        effective_from: u256,
        effective_until: u256,
    ):
        import json
        self.agreement_id = agreement_id
        self.customer_name = customer_name
        self.provider_name = provider_name
        self.customer_address = customer_address
        self.provider_address = provider_address
        self.sla_verifier = sla_verifier_address
        self.uptime_monitor = uptime_monitor_address

        svc_list = json.loads(service_ids_json)
        for svc in svc_list:
            self.service_ids.append(svc)

        self.target_uptime_bps = target_uptime_bps
        self.penalty_model = penalty_model
        self.payment_schedule = payment_schedule
        self.base_payment_monthly = base_payment_monthly
        self.base_payment_yearly = base_payment_yearly
        self.settlement_count = u256(0)
        self.active = True
        self.created_at = u256(int(gl.block.timestamp))
        self.effective_from = effective_from
        self.effective_until = effective_until

    @gl.public.view
    def get_terms(self) -> dict:
        """Returns the full agreement terms. Readable by Internet Court."""
        services = []
        for i in range(len(self.service_ids)):
            services.append(self.service_ids[i])

        return {
            "agreement_id": self.agreement_id,
            "customer": self.customer_name,
            "provider": self.provider_name,
            "customer_address": str(self.customer_address),
            "provider_address": str(self.provider_address),
            "services": services,
            "target_uptime_bps": int(self.target_uptime_bps),
            "target_uptime_pct": int(self.target_uptime_bps) / 100,
            "penalty_model": self.penalty_model,
            "payment_schedule": self.payment_schedule,
            "base_payment_monthly": int(self.base_payment_monthly),
            "base_payment_yearly": int(self.base_payment_yearly),
            "active": self.active,
            "effective_from": int(self.effective_from),
            "effective_until": int(self.effective_until),
            "uptime_monitor": str(self.uptime_monitor),
            "sla_verifier": str(self.sla_verifier),
        }

    @gl.public.view
    def check_compliance(self, checks_to_evaluate: u256) -> dict:
        """
        Check current compliance for all services in this agreement.
        Reads uptime data from the UptimeMonitor contract.

        This is the method Internet Court validators call to evaluate
        an SLA dispute.
        """
        verifier = gl.ContractAt(self.sla_verifier)
        results = []
        all_met = True

        for i in range(len(self.service_ids)):
            service_id = self.service_ids[i]
            verification = verifier.view().verify_uptime(
                service_id,
                checks_to_evaluate,
                self.target_uptime_bps,
            )
            if not verification["sla_met"]:
                all_met = False
            results.append(verification)

        # Determine payment for this period
        if self.payment_schedule == "yearly":
            base_payment = int(self.base_payment_yearly)
        else:
            base_payment = int(self.base_payment_monthly)

        # If any service is non-compliant, calculate worst-case penalty
        worst_shortfall = 0
        for r in results:
            shortfall = r["shortfall_bps"]
            if shortfall > worst_shortfall:
                worst_shortfall = shortfall

        # Calculate penalty using the worst-performing service
        worst_measured = int(self.target_uptime_bps) - worst_shortfall
        penalty_info = verifier.view().calculate_penalty(
            u256(base_payment),
            u256(worst_measured),
            self.target_uptime_bps,
            self.penalty_model,
        )

        return {
            "agreement_id": self.agreement_id,
            "all_services_compliant": all_met,
            "service_results": results,
            "base_payment": base_payment,
            "penalty": penalty_info["penalty"],
            "net_payout": penalty_info["payout"],
            "protocol_fee": penalty_info["protocol_fee"],
            "penalty_model": self.penalty_model,
        }

    @gl.public.write
    def settle_period(
        self,
        period_start: u256,
        period_end: u256,
        checks_to_evaluate: u256,
    ) -> dict:
        """
        Settle a period. Records the result on-chain.
        Can be called by either party or by Internet Court.
        """
        compliance = self.check_compliance(checks_to_evaluate)

        idx = int(self.settlement_count)
        key = str(idx)

        # Determine measured uptime (worst service)
        worst_uptime = int(self.target_uptime_bps)
        for r in compliance["service_results"]:
            measured = r["measured_uptime_bps"]
            if measured < worst_uptime:
                worst_uptime = measured

        self.settlements[key] = PeriodSettlement(
            period_start=period_start,
            period_end=period_end,
            measured_uptime_bps=u256(worst_uptime),
            target_uptime_bps=self.target_uptime_bps,
            sla_met=compliance["all_services_compliant"],
            base_payment=u256(compliance["base_payment"]),
            penalty_applied=u256(compliance["penalty"]),
            net_payout=u256(compliance["net_payout"]),
            settled_at=u256(int(gl.block.timestamp)),
            settled_by="auto",
        )
        self.settlement_count = u256(idx + 1)

        return {
            "settlement_id": idx,
            "sla_met": compliance["all_services_compliant"],
            "measured_uptime_bps": worst_uptime,
            "penalty": compliance["penalty"],
            "net_payout": compliance["net_payout"],
        }

    @gl.public.view
    def get_settlement(self, settlement_id: u256) -> dict:
        key = str(int(settlement_id))
        s = self.settlements[key]
        return {
            "period_start": int(s.period_start),
            "period_end": int(s.period_end),
            "measured_uptime_bps": int(s.measured_uptime_bps),
            "target_uptime_bps": int(s.target_uptime_bps),
            "sla_met": s.sla_met,
            "base_payment": int(s.base_payment),
            "penalty_applied": int(s.penalty_applied),
            "net_payout": int(s.net_payout),
            "settled_at": int(s.settled_at),
            "settled_by": s.settled_by,
        }

    @gl.public.view
    def get_settlement_count(self) -> u256:
        return self.settlement_count

    @gl.public.view
    def get_settlement_history(self) -> list:
        """Returns all settlements. Useful for Internet Court evidence."""
        result = []
        count = int(self.settlement_count)
        for i in range(count):
            key = str(i)
            s = self.settlements[key]
            result.append({
                "id": i,
                "period_start": int(s.period_start),
                "period_end": int(s.period_end),
                "measured_uptime_bps": int(s.measured_uptime_bps),
                "target_uptime_bps": int(s.target_uptime_bps),
                "sla_met": s.sla_met,
                "base_payment": int(s.base_payment),
                "penalty_applied": int(s.penalty_applied),
                "net_payout": int(s.net_payout),
                "settled_at": int(s.settled_at),
                "settled_by": s.settled_by,
            })
        return result

    @gl.public.view
    def internet_court_summary(self) -> dict:
        """
        Structured summary for Internet Court.
        Returns everything a jury needs to evaluate an SLA dispute:
        the terms, current compliance, and settlement history.
        """
        terms = self.get_terms()
        history = self.get_settlement_history()

        return {
            "contract_type": "SLA Agreement",
            "terms": terms,
            "settlement_history": history,
            "total_settlements": int(self.settlement_count),
            "instructions": (
                "To verify compliance, call check_compliance() with "
                "the number of checks for the disputed period. "
                "The uptime data is read directly from the UptimeMonitor "
                "contract at " + str(self.uptime_monitor) + ". "
                "Penalty model: " + self.penalty_model + ". "
                "Target uptime: " + str(int(self.target_uptime_bps) / 100) + "%."
            ),
        }
