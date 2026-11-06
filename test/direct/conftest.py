"""Shared direct-mode setup. Runs ONE target's builds (contracts/build/<target>/),
picked by UPTIME_TARGET (see _target.py); gltest resolves the runner pinned in each
build's header from the genvm-manager release that target names, so these tests
import that network's real std lib, not a stand-in.

One v0.6 seam is fixed here: in GenVM v0.6 the host answers ExecPrompt with TEXT in
both response formats, and the SDK itself json.loads() it for
response_format="json" (genlayer/nondet/__init__.py: _decode_nondet_json).
gltest 0.30.0rc2's mock pre-parses JSON mocks into a dict, which the v0.6 SDK
rejects ("JSON result is not text"). The wrapper hands the SDK the text the
host would.
"""

import json
import os

import pytest

from _target import V06  # noqa: E402  (sets GENVM_VERSION before gltest loads)

import gltest.direct.wasi_mock as wasi_mock  # noqa: E402

_stock_llm = wasi_mock._handle_llm_request


def _llm_as_text(vm, data):
    response = vm._match_llm_mock(data.get("prompt", ""))
    if response is None:
        return _stock_llm(vm, data)  # strict / live / not-found paths
    if not isinstance(response, str):
        response = json.dumps(response)
    return {"ok": response}


@pytest.fixture(autouse=True)
def _v06_llm_text(monkeypatch):
    if not V06:
        return  # v0.2 (Studio) takes the parsed dict gltest hands it
    monkeypatch.setattr(wasi_mock, "_handle_llm_request", _llm_as_text)
