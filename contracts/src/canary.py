# GENVM-RUNNER-HEADER: replaced per target by contracts/build.py (contracts/targets.json). Deploy contracts/build/<target>/, never this file.

# ==============================================================================
# NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
# ==============================================================================

# Deployed fresh every heartbeat tick. No LLM, no web: it measures only that a
# deploy is accepted and how long that takes.

import genlayer as gl


class Canary(gl.contract.Contract):
    tick: gl.u256

    def __init__(self, tick: gl.u256):
        self.tick = tick

    @gl.public.view
    def get_tick(self) -> gl.u256:
        return self.tick
