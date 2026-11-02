# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

# ==============================================================================
# NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
# ==============================================================================

# Ask: preset 4 ("Ask the web / LLM") of docs/PRODUCT.md §4.
#
# Deployed ONCE per network by us; users never deploy it. Optionally reads a page (any URL; a
# "web search" is a search-results URL, since GenVM has no search primitive), asks the model the
# user's question, and stores a SHORT NORMALIZED answer. Same consensus as Heartbeat's probe_llm
# (contracts/heartbeat.py): every validator re-asks and must reach the same normalized answer.
# Open-ended questions will split validators; that is a measurement, not a bug. Nothing is graded
# here: the answer is recorded, and judging it is the reader's business.
#
# Anyone may call it; results are filed under the CALLER's address (see contracts/web_probe.py).

from genlayer import *
from dataclasses import dataclass
import json
import re

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

KEEP = 32
MAX_ID = 128
MAX_URL = 2048
MAX_QUESTION = 1000
PAGE_CHARS = 4000
ANSWER_CHARS = 64


@allow_storage
@dataclass
class Record:
    run_id: str
    question: str
    source_url: str
    answer: str


def _expect(cond: bool, msg: str) -> None:
    if not cond:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {msg}")


def normalize(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^a-z0-9 ]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _handle_leader_error(leaders_res, leader_fn) -> bool:
    leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
    try:
        leader_fn()
        return False
    except gl.vm.UserError as e:
        validator_msg = e.message if hasattr(e, "message") else str(e)
        if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
            return validator_msg == leader_msg
        if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
            return True
        return False
    except Exception:
        return False


def _read_page(url: str) -> str:
    try:
        res = gl.nondet.web.get(url)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} source unreachable")
    status = int(res.status)
    if status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} source returned {status}")
    if status >= 400:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} source returned {status}")
    text = res.body.decode("utf-8", errors="replace") if res.body else ""
    # Crude HTML strip: the model needs words, not markup.
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:PAGE_CHARS]


class Ask(gl.Contract):
    slots: TreeMap[str, Record]
    counts: TreeMap[str, u256]

    def __init__(self):
        pass

    def _base(self, caller: str, uptime_id: str) -> str:
        return caller.lower() + "|" + uptime_id

    def _store(self, uptime_id: str, rec: Record) -> None:
        base = self._base(gl.message.sender_address.as_hex, uptime_id)
        n = int(self.counts.get(base, u256(0)))
        for i in range(max(0, n - KEEP), n):
            key = base + "|" + str(i % KEEP)
            if self.slots[key].run_id == rec.run_id:
                self.slots[key] = rec
                return
        self.slots[base + "|" + str(n % KEEP)] = rec
        self.counts[base] = u256(n + 1)

    def _rows(self, caller: str, uptime_id: str) -> list:
        base = self._base(Address(caller).as_hex, uptime_id)
        n = int(self.counts.get(base, u256(0)))
        out = []
        for i in range(n - 1, max(0, n - KEEP) - 1, -1):
            r = self.slots[base + "|" + str(i % KEEP)]
            out.append({"run_id": r.run_id, "question": r.question, "source_url": r.source_url, "answer": r.answer})
        return out

    @gl.public.write
    def ask(self, uptime_id: str, run_id: str, question: str, source_url: str) -> str:
        """Ask `question`, with the text of `source_url` as context when it is non-empty.
        Stores and returns the normalized answer (lowercase a-z0-9 and spaces, max 64 chars)."""
        _expect(0 < len(uptime_id) <= MAX_ID and "|" not in uptime_id, "bad uptime_id")
        _expect(0 < len(run_id) <= MAX_ID, "bad run_id")
        _expect(0 < len(question.strip()) <= MAX_QUESTION, "bad question")
        _expect(len(source_url) <= MAX_URL, "url too long")
        if source_url != "":
            _expect(source_url.startswith("https://") or source_url.startswith("http://"), "url must be http(s)")

        def leader_fn() -> str:
            context = ""
            if source_url:
                context = "Page content:\n<<<\n" + _read_page(source_url) + "\n>>>\n\n"
            prompt = (
                context
                + "Question: " + question + "\n\n"
                + 'Reply with JSON only: {"answer": "<the shortest possible answer, one word or number if possible>"}'
            )
            res = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(res, dict):
                raise gl.vm.UserError(f"{ERROR_LLM} non-dict response")
            raw = res.get("answer")
            if raw is None:
                for alt in ("result", "value", "response"):
                    if alt in res:
                        raw = res[alt]
                        break
            if raw is None:
                raise gl.vm.UserError(f"{ERROR_LLM} missing answer, keys {list(res.keys())}")
            answer = normalize(str(raw))
            if not answer:
                raise gl.vm.UserError(f"{ERROR_LLM} empty answer")
            return answer[:ANSWER_CHARS]

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            return leaders_res.calldata == leader_fn()

        answer = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self._store(uptime_id, Record(run_id=run_id, question=question, source_url=source_url, answer=answer))
        return answer

    @gl.public.view
    def get_latest(self, caller: str, uptime_id: str, limit: u256) -> list:
        return self._rows(caller, uptime_id)[: int(limit)]

    @gl.public.view
    def get_run(self, caller: str, uptime_id: str, run_id: str) -> dict:
        for row in self._rows(caller, uptime_id):
            if row["run_id"] == run_id:
                return row
        return {}

    @gl.public.view
    def get_count(self, caller: str, uptime_id: str) -> u256:
        return self.counts.get(self._base(Address(caller).as_hex, uptime_id), u256(0))
