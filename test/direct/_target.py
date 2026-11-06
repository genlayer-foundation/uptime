"""Which build the direct tests run: UPTIME_TARGET (default bradbury), one of contracts/targets.json.

gltest picks the SDK from the contract's runner header, out of the genvm-manager release named
by GENVM_VERSION, so each target runs against its own network's real std lib:

    UPTIME_TARGET=bradbury .venv/bin/pytest test/direct -q
    UPTIME_TARGET=studio   .venv/bin/pytest test/direct -q
"""

import json
import os

TARGETS = json.load(open("contracts/targets.json"))["targets"]
TARGET = os.environ.get("UPTIME_TARGET", "bradbury")
if TARGET not in TARGETS:
    raise SystemExit(f"UPTIME_TARGET={TARGET!r}: not in contracts/targets.json ({', '.join(TARGETS)})")
SPEC = TARGETS[TARGET]
# The GenVM release the target network runs. A GENVM_VERSION already in the env wins.
os.environ.setdefault("GENVM_VERSION", SPEC["genvm"])
V06 = SPEC["genvm"].startswith("v0.6")


def contract(name: str) -> str:
    """The deployable build of contracts/src/<name>.py for this target."""
    return f"contracts/build/{TARGET}/{name}.py"


def source(name: str) -> str:
    """The logical source (no runner header): for text checks shared by every target."""
    return f"contracts/src/{name}.py"
