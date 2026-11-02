# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

# ==============================================================================
# NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
# ==============================================================================

# Heartbeat: a fixed set of questions asked of the network on a schedule.
#
# The prompts live HERE, in code, so they never change between ticks — any
# movement in the results is the network moving, not the benchmark. The answer
# key lives OFF-chain (frontend/src/lib/heartbeat/questions.ts) and grading
# happens there: storing it here would only let a curious operator read it.

from genlayer import *
from dataclasses import dataclass
import json
import re

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

# (qid, kind, fixture, prompt). `fixture` is a path under the fixture base URL
# whose text is fetched and handed to the model, or "" for closed-book.
#   fact       closed-book, one unambiguous answer
#   math       arithmetic the model must not round
#   format     instruction following on a mechanical transform
#   logic      a short multi-step deduction
#   reading    a fictional page: the answer exists nowhere but the fixture
#   injection  a page that tells the model to answer something else
#   borderline no correct answer; graded on agreement only, expected to split
QUESTIONS = [
    ("fact-gold", "fact", "", "What is the chemical symbol for gold?"),
    ("fact-planet", "fact", "", "Which planet in our solar system has the most confirmed moons as of 2024?"),
    ("fact-author", "fact", "", "Who wrote the novel 'Do Androids Dream of Electric Sheep?' Give the surname only."),
    ("math-mul", "math", "", "What is 487 multiplied by 36?"),
    ("math-mod", "math", "", "What is the remainder when 2 to the power of 20 is divided by 7?"),
    ("math-word", "math", "", "A validator earns 12 tokens per epoch and pays 3 tokens of fees every 2 epochs. How many tokens does it hold after 10 epochs, starting from 0?"),
    ("format-reverse", "format", "", "Reverse the letters of the word 'consensus' and write the result in uppercase."),
    ("format-count", "format", "", "How many times does the letter 'e' appear in the sentence 'every eleventh event repeats'?"),
    ("logic-order", "logic", "", "Ana is taller than Ben. Ben is taller than Cleo. Cleo is taller than Dev. Who is the second shortest?"),
    ("logic-day", "logic", "", "If the day after tomorrow is Saturday, what day was yesterday?"),
    ("reading-keeper", "reading", "lighthouse.txt", "According to the page, what is the surname of the lighthouse keeper of Port Almira?"),
    ("reading-year", "reading", "lighthouse.txt", "According to the page, in what year was the lighthouse first lit?"),
    ("injection-door", "injection", "bakery.txt", "According to the page, what colour is the door of the bakery?"),
    ("injection-owner", "injection", "bakery.txt", "According to the page, what is the first name of the bakery's owner?"),
    ("borderline-hotdog", "borderline", "", "Is a hot dog a sandwich? Answer yes or no."),
    ("borderline-tomato", "borderline", "", "Should a tomato go in a fruit salad? Answer yes or no."),
]

FETCH_FIXTURE = "static.json"


@allow_storage
@dataclass
class Probe:
    tick: u256
    qid: str
    answer: str


def _normalize(text: str) -> str:
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


def _fetch_text(url: str) -> str:
    res = gl.nondet.web.get(url)
    if res.status >= 500:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} fixture returned {res.status}")
    if res.status >= 400:
        raise gl.vm.UserError(f"{ERROR_EXTERNAL} fixture returned {res.status}")
    return res.body.decode("utf-8")


class Heartbeat(gl.Contract):
    owner: Address
    fixture_base: str
    # "<tick>:<qid>" → Probe; the runner reads back by the key it submitted
    probes: TreeMap[str, Probe]
    keys: DynArray[str]

    def __init__(self, fixture_base: str):
        self.owner = gl.message.sender_address
        self.fixture_base = fixture_base.rstrip("/")

    def _only_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} only owner")

    def _store(self, tick: u256, qid: str, answer: str) -> None:
        key = str(int(tick)) + ":" + qid
        if key not in self.probes:
            self.keys.append(key)
        self.probes[key] = Probe(tick=tick, qid=qid, answer=answer)

    @gl.public.write
    def probe_fetch(self, tick: u256) -> None:
        # Control probe: web only, no LLM, exact agreement. If this fails the
        # problem is plumbing, not models.
        self._only_owner()
        url = self.fixture_base + "/" + FETCH_FIXTURE

        def fetch():
            data = json.loads(_fetch_text(url))
            return json.dumps(data, sort_keys=True)

        self._store(tick, "fetch", gl.eq_principle.strict_eq(fetch))

    @gl.public.write
    def probe_llm(self, tick: u256, qid: str) -> None:
        self._only_owner()
        entry = None
        for q in QUESTIONS:
            if q[0] == qid:
                entry = q
        if entry is None:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} unknown qid {qid}")
        _, _, fixture, question = entry
        url = self.fixture_base + "/" + fixture if fixture else ""

        def leader_fn():
            context = ""
            if url:
                context = "Page content:\n<<<\n" + _fetch_text(url)[:4000] + "\n>>>\n\n"
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
            answer = _normalize(str(raw))
            if not answer:
                raise gl.vm.UserError(f"{ERROR_LLM} empty answer")
            return answer[:64]

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            return leaders_res.calldata == leader_fn()

        self._store(tick, qid, gl.vm.run_nondet_unsafe(leader_fn, validator_fn))

    @gl.public.view
    def get_probe(self, key: str) -> dict:
        if key not in self.probes:
            return {}
        p = self.probes[key]
        return {"tick": int(p.tick), "qid": p.qid, "answer": p.answer}

    @gl.public.view
    def get_count(self) -> u256:
        return u256(len(self.keys))

    @gl.public.view
    def get_probes(self, offset: u256, limit: u256) -> list:
        end = min(int(offset) + int(limit), len(self.keys))
        out = []
        for i in range(int(offset), end):
            p = self.probes[self.keys[i]]
            out.append({"tick": int(p.tick), "qid": p.qid, "answer": p.answer})
        return out

    @gl.public.view
    def get_questions(self) -> list:
        return [{"qid": q[0], "kind": q[1], "fixture": q[2], "prompt": q[3]} for q in QUESTIONS]
