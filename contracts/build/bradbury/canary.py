# { "Seq": [{"Depends": "py-genlayer:kzybg95x1gn21dw72m7hyg0maaap04n4nx55j9yt6fkdqxtz6bz0"}] }

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
