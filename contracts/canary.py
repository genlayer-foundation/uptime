# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

# ==============================================================================
# NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
# ==============================================================================

# Deployed fresh every heartbeat tick. No LLM, no web: it measures only that a
# deploy is accepted and how long that takes.

from genlayer import *


class Canary(gl.Contract):
    tick: u256

    def __init__(self, tick: u256):
        self.tick = tick

    @gl.public.view
    def get_tick(self) -> u256:
        return self.tick
