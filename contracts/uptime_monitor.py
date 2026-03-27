# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

from genlayer import *
from dataclasses import dataclass
import json


@allow_storage
@dataclass
class CheckResult:
    timestamp: u256
    is_up: bool
    extra_data: str


# Service definitions: (service_id, check_type, url)
# check_type: "rpc" = JSON-RPC eth_blockNumber, "http" = HTTP GET 200
SERVICES = [
    ("zksync_bridge", "rpc", "https://zksync-os-testnet-genlayer.zksync.dev"),
    ("studionet_rpc", "rpc", "https://studio.genlayer.com/api"),
    ("asimov_rpc", "rpc", "https://rpc-asimov.genlayer.com"),
    ("bradbury_rpc", "rpc", "https://rpc-bradbury.genlayer.com"),
    ("explorer_studio", "http", "https://explorer-studio.genlayer.com"),
    ("explorer_asimov", "http", "https://explorer-asimov.genlayer.com"),
    ("explorer_bradbury", "http", "https://explorer-bradbury.genlayer.com"),
]


class UptimeMonitor(gl.Contract):
    # Composite key: "service_id:index" → CheckResult
    checks: TreeMap[str, CheckResult]
    check_count: TreeMap[str, u256]
    services: DynArray[str]

    def __init__(self):
        for service_id, _, _ in SERVICES:
            self.services.append(service_id)
            self.check_count[service_id] = u256(0)

    @gl.public.write
    def run_checks(self, timestamp: u256) -> None:
        for service_id, check_type, url in SERVICES:
            result = self._check_service(check_type, url)
            is_up = result["is_up"]
            extra_data = result.get("extra_data", "")

            idx = int(self.check_count[service_id])
            key = service_id + ":" + str(idx)
            self.checks[key] = CheckResult(
                timestamp=timestamp,
                is_up=is_up,
                extra_data=extra_data,
            )
            self.check_count[service_id] = u256(idx + 1)

    def _check_service(self, check_type: str, url: str) -> dict:
        def do_check():
            try:
                if check_type == "rpc":
                    payload = json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": 1,
                            "method": "eth_blockNumber",
                            "params": [],
                        }
                    ).encode("utf-8")
                    res = gl.nondet.web.post(
                        url,
                        body=payload,
                        headers={"Content-Type": "application/json"},
                    )
                    if res.status != 200:
                        return {
                            "is_up": False,
                            "extra_data": "HTTP " + str(res.status),
                        }
                    body = json.loads(res.body.decode("utf-8"))
                    if "result" in body:
                        return {
                            "is_up": True,
                            "extra_data": "",
                        }
                    else:
                        error_msg = str(body.get("error", {}).get("message", "unknown"))
                        return {
                            "is_up": False,
                            "extra_data": "rpc_error: " + error_msg,
                        }
                else:
                    res = gl.nondet.web.get(url)
                    if res.status == 200:
                        return {"is_up": True, "extra_data": ""}
                    else:
                        return {
                            "is_up": False,
                            "extra_data": "HTTP " + str(res.status),
                        }
            except Exception as e:
                return {"is_up": False, "extra_data": str(e)[:200]}

        return gl.eq_principle.strict_eq(do_check)

    @gl.public.view
    def get_checks(self, service_id: str, offset: u256, limit: u256) -> list:
        off = int(offset)
        lim = int(limit)
        total = int(self.check_count[service_id])
        end = min(off + lim, total)
        results = []
        for i in range(off, end):
            key = service_id + ":" + str(i)
            c = self.checks[key]
            results.append(
                {
                    "timestamp": int(c.timestamp),
                    "is_up": c.is_up,
                    "extra_data": c.extra_data,
                }
            )
        return results

    @gl.public.view
    def get_latest_check(self, service_id: str) -> dict:
        count = int(self.check_count[service_id])
        if count == 0:
            return {}
        key = service_id + ":" + str(count - 1)
        c = self.checks[key]
        return {
            "timestamp": int(c.timestamp),
            "is_up": c.is_up,
            "extra_data": c.extra_data,
        }

    @gl.public.view
    def get_all_latest(self) -> dict:
        result = {}
        for i in range(len(self.services)):
            service_id = self.services[i]
            count = int(self.check_count[service_id])
            if count > 0:
                key = service_id + ":" + str(count - 1)
                c = self.checks[key]
                result[service_id] = {
                    "timestamp": int(c.timestamp),
                    "is_up": c.is_up,
                    "extra_data": c.extra_data,
                }
        return result

    @gl.public.view
    def get_check_count(self, service_id: str) -> u256:
        return self.check_count[service_id]

    @gl.public.view
    def get_services(self) -> list:
        result = []
        for i in range(len(self.services)):
            result.append(self.services[i])
        return result

    @gl.public.view
    def get_uptime_stats(self, service_id: str, last_n: u256) -> dict:
        count = int(self.check_count[service_id])
        n = min(int(last_n), count)
        if n == 0:
            return {"total": 0, "up": 0, "uptime_pct": 0}
        up = 0
        start = count - n
        for i in range(start, count):
            key = service_id + ":" + str(i)
            if self.checks[key].is_up:
                up += 1
        pct = (up * 10000) // n  # basis points for precision
        return {"total": n, "up": up, "uptime_pct": int(pct)}
