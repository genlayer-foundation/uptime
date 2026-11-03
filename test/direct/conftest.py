"""Shared direct-mode setup for the GenVM v0.6 SDK (py-genlayer:babwp9t…).

The contracts pin the runner Bradbury runs; gltest resolves it from the
genvm-manager release named by GENVM_VERSION (default below), so these tests
import that release's real std lib, not a stand-in.

One seam is fixed here: in GenVM v0.6 the host answers ExecPrompt with TEXT in
both response formats, and the SDK itself json.loads() it for
response_format="json" (genlayer/nondet/__init__.py: _decode_nondet_json).
gltest 0.30.0rc2's mock pre-parses JSON mocks into a dict, which the v0.6 SDK
rejects ("JSON result is not text"). The wrapper hands the SDK the text the
host would.
"""

import json
import os

import pytest

# The GenVM release Bradbury runs (node v0.6.0-rc.3). Override with GENVM_VERSION.
os.environ.setdefault("GENVM_VERSION", "v0.6.0-rc10")

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
    monkeypatch.setattr(wasi_mock, "_handle_llm_request", _llm_as_text)
