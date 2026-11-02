# { "Seq": [{"Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"}] }

# ==============================================================================
# NOT AUDITED — TESTNET ONLY. Do not deposit anything you can't lose.
# ==============================================================================

# MailEscrow: email credit held in escrow, released to the Uptime project wallet only against
# proof that the email went out. Design, trust analysis and the mailer-side flow:
# contracts/MAIL_ESCROW.md.
#
# Owners deposit native GEN as credit for one job: (owner, job_id). For each alert email the
# mailer sends, it publishes the DKIM-signed raw message at a short-lived URL and calls
# `claim` with that URL and the message's sha256. Every validator fetches the message, checks
# the hash, fetches the sending domain's DKIM public key over DNS-over-HTTPS, checks it against
# the key pinned here, and verifies the RSA-SHA256 signature itself. The signed message must
# be addressed (signed To:) to one of the job's registered recipient hashes and carry this
# email's receipt token in its signed body. Only then does the fee move to the payee.
#
# What a passing claim proves: the holder of the pinned DKIM private key (the email provider)
# signed a message with these headers and this body. It does NOT prove delivery or reading.

from genlayer import *
from dataclasses import dataclass
import base64
import datetime
import hashlib
import json
import re

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"

TOKEN_PREFIX = "uptime-receipt-v1-"
TEMPLATES = ("alert",)  # mail kinds that are charged; verification mail is free
DEFAULT_DAILY_CAP = 10
MAX_DAILY_CAP = 100
MAX_RECIPIENTS = 3
DEFAULT_TTL = 90 * 86400
MAX_TTL = 365 * 86400
CLAIM_WINDOW = 7 * 86400  # a message older than this cannot be claimed
MAX_SKEW = 600  # a signature dated this far past block time is refused
MAX_EVIDENCE = 512 * 1024
MIN_KEY_BITS = 1024
MAX_ID = 128
MAX_URL = 2048
DAY = 86400

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_SELECTOR = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
_DOMAIN = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")
# DigestInfo prefix for SHA-256 (RFC 8017 §9.2, note 1)
_SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")
_RSA_OID = bytes.fromhex("2a864886f70d010101")


@allow_storage
@dataclass
class Job:
    owner: Address
    job_id: str
    balance: u256
    daily_cap: u32
    created_at: u64
    expires_at: u64
    recipients: str  # comma-joined recipient hashes (see recipient_hash)
    claimed: u64


@allow_storage
@dataclass
class Claim:
    job_key: str
    amount: u256
    signed_at: u64
    selector: str


@allow_storage
@dataclass
class Pending:
    value: str
    eta: u64


@gl.evm.contract_interface
class _Wallet:
    class View:
        pass

    class Write:
        pass


def _expect(cond: bool, msg: str) -> None:
    if not cond:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} {msg}")


def _now() -> int:
    # GenVM wires the stdlib clock to the transaction datetime: identical on every validator.
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp())


def _addr(a: str) -> Address:
    try:
        return Address(a)
    except Exception:
        raise gl.vm.UserError(f"{ERROR_EXPECTED} bad address")


def _hex(a: Address) -> str:
    return a.as_hex.lower()


def _job_key(owner: Address, job_id: str) -> str:
    return _hex(owner) + "|" + job_id


def _canon(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------- public helpers (also used off-chain)


def recipient_hash(email: str, owner_hex: str) -> str:
    """sha256("<lowercased address>|<lowercased owner wallet>"). Salted by the owner so one
    table cannot be reused across owners; a targeted guess of a known address still works."""
    return hashlib.sha256((email.strip().lower() + "|" + owner_hex.strip().lower()).encode()).hexdigest()


def receipt_token(contract_hex: str, owner_hex: str, job_id: str, email_id: str, template: str) -> str:
    """The line the mailer puts in the email body. Hex and '-' only, so quoted-printable
    leaves it intact. Binds one message to one (escrow, owner, job, email, template)."""
    pre = "|".join(["uptime-mail-escrow/v1", contract_hex.lower(), owner_hex.lower(), job_id, email_id, template])
    return TOKEN_PREFIX + hashlib.sha256(pre.encode()).hexdigest()[:32]


# ---------------------------------------------------------------- DKIM (RFC 6376), pure functions


def split_message(raw: bytes):
    """-> ([(lower name, raw header bytes incl. CRLF)], body bytes). Bare LF becomes CRLF."""
    raw = re.sub(rb"(?<!\r)\n", b"\r\n", raw)
    sep = raw.find(b"\r\n\r\n")
    if sep < 0:
        raise ValueError("no_body_separator")
    head, body = raw[: sep + 2], raw[sep + 4 :]
    headers = []
    for line in head.split(b"\r\n")[:-1]:
        if line[:1] in (b" ", b"\t"):
            if not headers:
                raise ValueError("bad_header_fold")
            name, val = headers[-1]
            headers[-1] = (name, val + line + b"\r\n")
            continue
        colon = line.find(b":")
        if colon <= 0:
            raise ValueError("bad_header")
        headers.append((line[:colon].strip().lower().decode("ascii", "replace"), line + b"\r\n"))
    return headers, body


def _relaxed_header(raw: bytes) -> bytes:
    colon = raw.find(b":")
    name = raw[:colon].strip().lower()
    val = raw[colon + 1 :].replace(b"\r\n", b"")
    val = re.sub(rb"[ \t]+", b" ", val).strip(b" \t")
    return name + b":" + val + b"\r\n"


def canon_header(raw: bytes, mode: str) -> bytes:
    return _relaxed_header(raw) if mode == "relaxed" else raw


def canon_body(body: bytes, mode: str) -> bytes:
    if mode == "relaxed":
        lines = [re.sub(rb"[ \t]+", b" ", ln).rstrip(b" ") for ln in body.split(b"\r\n")]
        while lines and lines[-1] == b"":
            lines.pop()
        return b"".join(ln + b"\r\n" for ln in lines)
    while body.endswith(b"\r\n\r\n"):
        body = body[:-2]
    if body == b"" or body == b"\r\n":
        return b"\r\n"
    return body if body.endswith(b"\r\n") else body + b"\r\n"


def parse_tags(value: str) -> dict:
    out = {}
    for part in value.split(";"):
        if part.strip() == "":
            continue
        if "=" not in part:
            raise ValueError("bad_tag")
        k, v = part.split("=", 1)
        k = k.strip()
        if k in out:
            raise ValueError("duplicate_tag")
        out[k] = v.strip()
    return out


def _header_value(raw: bytes) -> str:
    return raw[raw.find(b":") + 1 :].replace(b"\r\n", b"").decode("utf-8", "replace")


def _der(buf: bytes, pos: int):
    """One DER TLV at pos -> (tag, content, next_pos)."""
    if pos + 2 > len(buf):
        raise ValueError("der_short")
    tag, ln = buf[pos], buf[pos + 1]
    pos += 2
    if ln & 0x80:
        n = ln & 0x7F
        if n == 0 or n > 4 or pos + n > len(buf):
            raise ValueError("der_len")
        ln = int.from_bytes(buf[pos : pos + n], "big")
        pos += n
    if pos + ln > len(buf):
        raise ValueError("der_short")
    return tag, buf[pos : pos + ln], pos + ln


def rsa_public_key(der: bytes):
    """SubjectPublicKeyInfo or bare PKCS#1 RSAPublicKey -> (n, e)."""
    tag, seq, _ = _der(der, 0)
    if tag != 0x30:
        raise ValueError("key_not_sequence")
    t1, c1, p = _der(seq, 0)
    if t1 == 0x30:  # SPKI: AlgorithmIdentifier, BIT STRING
        to, oid, _ = _der(c1, 0)
        if to != 0x06 or oid != _RSA_OID:
            raise ValueError("key_not_rsa")
        tb, bits, _ = _der(seq, p)
        if tb != 0x03 or not bits or bits[0] != 0:
            raise ValueError("key_bitstring")
        return rsa_public_key(bits[1:])
    if t1 != 0x02:
        raise ValueError("key_modulus")
    t2, c2, _ = _der(seq, p)
    if t2 != 0x02:
        raise ValueError("key_exponent")
    return int.from_bytes(c1, "big"), int.from_bytes(c2, "big")


def rsa_sha256_verify(n: int, e: int, digest: bytes, sig: bytes) -> bool:
    k = (n.bit_length() + 7) // 8
    if len(sig) != k:
        return False
    s = int.from_bytes(sig, "big")
    if s >= n:
        return False
    em = pow(s, e, n).to_bytes(k, "big")
    t = _SHA256_DIGEST_INFO + digest
    if k < len(t) + 11:
        return False
    return em == b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t


def _b64(s: str) -> bytes:
    return base64.b64decode(re.sub(r"\s+", "", s), validate=True)


def dkim_key_record(txt: str):
    """A DKIM key TXT record -> DER key bytes. Raises ValueError on a revoked or non-RSA key."""
    tags = parse_tags(txt)
    if tags.get("v", "DKIM1") != "DKIM1":
        raise ValueError("key_version")
    if tags.get("k", "rsa") != "rsa":
        raise ValueError("key_not_rsa")
    p = re.sub(r"\s+", "", tags.get("p", ""))
    if p == "":
        raise ValueError("key_revoked")
    return _b64(p)


def verify_message(raw: bytes, domain: str, pins: dict, fetch_key) -> dict:
    """Verify the message's DKIM-Signature for `domain` against a pinned key.

    pins: selector -> sha256 hex of the DER key. fetch_key(selector) -> TXT record text, or ""
    when the name does not exist. Returns {ok, reason, selector, t, to_hash_input, body_c,
    sig_hash}. Deterministic given the same bytes and the same DNS answer."""
    fail = {"ok": False, "reason": "", "selector": "", "t": 0, "to": "", "sig_hash": "", "body": b""}
    try:
        headers, body = split_message(raw)
    except ValueError as e:
        return {**fail, "reason": str(e)}
    names = [h[0] for h in headers]
    if names.count("from") != 1 or names.count("to") != 1:
        return {**fail, "reason": "need_one_from_and_one_to"}

    sigs = [h for h in headers if h[0] == "dkim-signature"]
    if not sigs:
        return {**fail, "reason": "no_dkim_signature"}
    reason = "no_signature_for_domain"
    for _, sig_raw in sigs:
        try:
            tags = parse_tags(_header_value(sig_raw))
        except ValueError as e:
            reason = str(e)
            continue
        if tags.get("d", "").lower() != domain:
            continue
        r = _verify_one(headers, body, sig_raw, tags, pins, fetch_key)
        if r["ok"]:
            return r
        reason = r["reason"]
    return {**fail, "reason": reason}


def _verify_one(headers, body, sig_raw, tags, pins, fetch_key) -> dict:
    fail = {"ok": False, "reason": "", "selector": "", "t": 0, "to": "", "sig_hash": "", "body": b""}
    if tags.get("v") != "1":
        return {**fail, "reason": "sig_version"}
    if tags.get("a") != "rsa-sha256":
        return {**fail, "reason": "sig_algorithm"}
    if "l" in tags:
        return {**fail, "reason": "sig_body_length_limit"}  # an l= tag lets text be appended
    for req in ("b", "bh", "h", "s", "t"):
        if tags.get(req, "") == "":
            return {**fail, "reason": "sig_missing_" + req}
    selector = tags["s"]
    if selector not in pins:
        return {**fail, "reason": "selector_not_pinned"}
    c = tags.get("c", "simple/simple").split("/")
    hc, bc = c[0], (c[1] if len(c) > 1 else "simple")
    if hc not in ("simple", "relaxed") or bc not in ("simple", "relaxed"):
        return {**fail, "reason": "sig_canonicalization"}
    try:
        t = int(tags["t"])
        x = int(tags["x"]) if tags.get("x", "") != "" else 0
    except ValueError:
        return {**fail, "reason": "sig_timestamp"}
    if x and x < t:
        return {**fail, "reason": "sig_expiry_before_timestamp"}
    signed = [n.strip().lower() for n in tags["h"].split(":")]
    if "from" not in signed or "to" not in signed:
        return {**fail, "reason": "from_and_to_must_be_signed"}

    body_c = canon_body(body, bc)
    try:
        bh = _b64(tags["bh"])
        sig = _b64(tags["b"])
    except Exception:
        return {**fail, "reason": "sig_base64"}
    if hashlib.sha256(body_c).digest() != bh:
        return {**fail, "reason": "body_hash_mismatch"}

    # Header hash input: each h= name takes the next unused instance from the bottom.
    used = {}
    data = b""
    to_raw = b""
    for name in signed:
        idx = [i for i, h in enumerate(headers) if h[0] == name]
        k = used.get(name, 0)
        used[name] = k + 1
        if k >= len(idx):
            continue  # a signed-but-absent header contributes nothing (RFC 6376 §5.4.2)
        hraw = headers[idx[-1 - k]][1]
        if name == "to":
            to_raw = hraw
        data += canon_header(hraw, hc)
    stripped = re.sub(rb"(^|;)(\s*b\s*=)[^;]*", rb"\1\2", sig_raw[sig_raw.find(b":") + 1 :])
    sig_c = canon_header(sig_raw[: sig_raw.find(b":") + 1] + stripped, hc)
    if sig_c.endswith(b"\r\n"):
        sig_c = sig_c[:-2]
    data += sig_c

    txt = fetch_key(selector)
    if txt == "":
        return {**fail, "reason": "dkim_key_missing"}
    try:
        der = dkim_key_record(txt)
    except Exception as e:
        return {**fail, "reason": str(e) if isinstance(e, ValueError) else "key_record"}
    if hashlib.sha256(der).hexdigest() != pins[selector]:
        return {**fail, "reason": "dns_key_not_pinned_key"}
    try:
        n, e = rsa_public_key(der)
    except ValueError as err:
        return {**fail, "reason": str(err)}
    if n.bit_length() < MIN_KEY_BITS:
        return {**fail, "reason": "key_too_short"}
    if not rsa_sha256_verify(n, e, hashlib.sha256(data).digest(), sig):
        return {**fail, "reason": "bad_signature"}
    return {
        "ok": True,
        "reason": "",
        "selector": selector,
        "t": t,
        "to": _header_value(to_raw),
        "sig_hash": hashlib.sha256(sig).hexdigest(),
        "body": body_c,
    }


def single_address(to_value: str) -> str:
    """The one address in a To: value ("Name <a@b>" or "a@b"), lowercased; "" if not exactly one."""
    v = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "", to_value)  # drop quoted display names
    parts = [p.strip() for p in re.split(r"[,;]", v) if p.strip()]
    if len(parts) != 1:
        return ""
    m = re.fullmatch(r"[^<>]*<([^<>\s@]+@[^<>\s@]+)>", parts[0])
    if m is None:
        m = re.fullmatch(r"([^<>\s@\"]+@[^<>\s@\"]+)", parts[0])
    return m.group(1).lower() if m else ""


def dns_txt(doc: dict) -> str:
    """A DNS-over-HTTPS JSON answer (dns.google / Cloudflare shape) -> the DKIM TXT text, ""
    on NXDOMAIN. Raises ValueError on an ambiguous or unusable answer."""
    status = doc.get("Status")
    if status == 3:
        return ""
    if status != 0:
        raise ValueError("dns_status_" + str(status))
    txts = []
    for a in doc.get("Answer") or []:
        if a.get("type") != 16:
            continue
        data = str(a.get("data", ""))
        parts = re.findall(r'"((?:[^"\\]|\\.)*)"', data)
        txts.append("".join(parts) if parts else data)
    keys = [t for t in txts if "p=" in t]
    if not keys:
        return ""
    if len(keys) > 1:
        raise ValueError("dns_multiple_keys")
    return keys[0]


def _fail_web(what: str, status: int) -> None:
    if status >= 500 or status == 429:
        raise gl.vm.UserError(f"{ERROR_TRANSIENT} {what} returned {status}")
    raise gl.vm.UserError(f"{ERROR_EXTERNAL} {what} returned {status}")


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


# ---------------------------------------------------------------- contract


class MailEscrow(gl.Contract):
    admin: Address
    mailer: Address  # the only account that may claim
    payee: Address  # the project wallet that receives released fees (may equal mailer)
    domain: str  # DKIM d= the messages must be signed for
    doh_base: str  # DNS-over-HTTPS JSON endpoint, e.g. https://dns.google/resolve
    price: u256  # wei per claimed email, fixed at deployment
    delay: u64  # seconds before an admin change (mailer, payee, new key) takes effect
    total_escrowed: u256
    total_released: u256
    jobs: TreeMap[str, Job]
    claims: TreeMap[str, Claim]  # email_id -> claim (replay protection)
    signatures: TreeMap[str, str]  # sha256(signature) -> email_id (one message, one claim)
    day_counts: TreeMap[str, u32]  # "<job_key>|<day>" -> claims dated that UTC day
    keys: TreeMap[str, Pending]  # selector -> (sha256 of DER key, active from)
    pending: TreeMap[str, Pending]  # "mailer" | "payee" -> proposed value

    def __init__(
        self,
        mailer: str,
        payee: str,
        domain: str,
        selector: str,
        key_sha256: str,
        price: u256,
        delay: u64,
        doh_base: str,
    ):
        self.admin = gl.message.sender_address
        self.mailer = _addr(mailer)
        self.payee = _addr(payee)
        d = domain.strip().lower()
        _expect(_DOMAIN.match(d) is not None, "bad domain")
        self.domain = d
        _expect(int(price) > 0, "price must be > 0")
        self.price = price
        self.delay = delay
        _expect(doh_base.startswith("https://") and len(doh_base) <= 256, "doh_base must be https")
        self.doh_base = doh_base.rstrip("/")
        self._check_key(selector, key_sha256)
        self.keys[selector] = Pending(value=key_sha256.lower(), eta=u64(0))

    # ---------------------------------------------------------------- owner

    @gl.public.write.payable
    def open_job(self, job_id: str, recipients: list[str], daily_cap: u32, ttl: u64) -> None:
        """Create the caller's escrow for `job_id` and deposit the attached GEN. `recipients` are
        recipient_hash() values (1-3). daily_cap 0 = default 10. ttl seconds, 0 = 90 days."""
        _expect(0 < len(job_id) <= MAX_ID and "|" not in job_id, "bad job_id")
        v = int(gl.message.value)
        _expect(v > 0, "deposit some GEN")
        owner = gl.message.sender_address
        key = _job_key(owner, job_id)
        _expect(key not in self.jobs, "job exists")
        now = _now()
        t = int(ttl) if int(ttl) else DEFAULT_TTL
        _expect(0 < t <= MAX_TTL, "bad ttl")
        self.jobs[key] = Job(
            owner=owner,
            job_id=job_id,
            balance=u256(v),
            daily_cap=u32(self._cap(int(daily_cap))),
            created_at=u64(now),
            expires_at=u64(now + t),
            recipients=self._recipients(recipients),
            claimed=u64(0),
        )
        self.total_escrowed = u256(int(self.total_escrowed) + v)

    @gl.public.write.payable
    def top_up(self, job_id: str) -> None:
        v = int(gl.message.value)
        _expect(v > 0, "deposit some GEN")
        job = self._owned(job_id)
        _expect(_now() < int(job.expires_at), "job expired")
        job.balance = u256(int(job.balance) + v)
        self.total_escrowed = u256(int(self.total_escrowed) + v)

    @gl.public.write
    def set_job(self, job_id: str, recipients: list[str], daily_cap: u32, expires_at: u64) -> None:
        """Replace recipients and cap, and move the expiry (any time up to now + 365 days;
        a past or present value expires the job now)."""
        job = self._owned(job_id)
        job.recipients = self._recipients(recipients)
        job.daily_cap = u32(self._cap(int(daily_cap)))
        _expect(int(expires_at) <= _now() + MAX_TTL, "bad expires_at")
        job.expires_at = expires_at

    @gl.public.write
    def withdraw(self, job_id: str, amount: u256) -> u256:
        """Withdraw unspent credit to the owner, immediately. amount 0 = everything."""
        job = self._owned(job_id)
        a = int(amount) if int(amount) else int(job.balance)
        _expect(a > 0, "nothing to withdraw")
        _expect(a <= int(job.balance), "insufficient balance")
        self._debit(job, a)
        self._pay(job.owner, a)
        return u256(a)

    @gl.public.write
    def refund_expired(self, owner: str, job_id: str) -> u256:
        """Anyone may push an expired job's remaining credit back to its owner."""
        key = _job_key(_addr(owner), job_id)
        _expect(key in self.jobs, "unknown job")
        job = self.jobs[key]
        _expect(_now() >= int(job.expires_at), "job not expired")
        a = int(job.balance)
        _expect(a > 0, "nothing to refund")
        self._debit(job, a)
        self._pay(job.owner, a)
        return u256(a)

    # ---------------------------------------------------------------- mailer

    @gl.public.write
    def claim(
        self,
        owner: str,
        job_id: str,
        email_id: str,
        template: str,
        evidence_url: str,
        evidence_sha256: str,
    ) -> dict:
        """Release one email's fee to the payee against its DKIM-signed raw message, published
        at `evidence_url` with sha256 `evidence_sha256`. Reverts unless every check passes."""
        _expect(gl.message.sender_address == self.mailer, "only mailer")
        _expect(0 < len(email_id) <= MAX_ID, "bad email_id")
        _expect(email_id not in self.claims, "email already claimed")
        _expect(template in TEMPLATES, "unknown template")
        _expect(evidence_url.startswith("https://") and len(evidence_url) <= MAX_URL, "evidence_url must be https")
        want = evidence_sha256.strip().lower()
        _expect(_HEX64.match(want) is not None, "bad evidence_sha256")
        owner_a = _addr(owner)
        key = _job_key(owner_a, job_id)
        _expect(key in self.jobs, "unknown job")
        job = self.jobs[key]
        now = _now()
        _expect(now < int(job.expires_at), "job expired")
        price = int(self.price)
        _expect(int(job.balance) >= price, "insufficient credit")

        token = receipt_token(_hex(gl.message.contract_address), _hex(owner_a), job_id, email_id, template)
        allowed = job.recipients.split(",") if job.recipients else []
        owner_hex = _hex(owner_a)
        pins = {}
        for sel, pin in self.keys.items():
            if int(pin.eta) <= now:
                pins[sel] = pin.value
        domain = self.domain
        doh = self.doh_base

        def leader_fn() -> dict:
            res = gl.nondet.web.get(evidence_url)
            if res.status != 200:
                _fail_web("evidence", int(res.status))
            raw = res.body or b""
            if len(raw) > MAX_EVIDENCE:
                return {"ok": False, "reason": "evidence_too_large"}
            if hashlib.sha256(raw).hexdigest() != want:
                return {"ok": False, "reason": "evidence_hash_mismatch"}

            def fetch_key(selector: str) -> str:
                r = gl.nondet.web.get(
                    doh + "?name=" + selector + "._domainkey." + domain + "&type=TXT",
                    headers={"accept": "application/dns-json"},
                )
                if r.status != 200:
                    _fail_web("dns", int(r.status))
                try:
                    return dns_txt(json.loads(r.body.decode("utf-8")))
                except ValueError as e:
                    raise gl.vm.UserError(f"{ERROR_TRANSIENT} {e}")

            v = verify_message(raw, domain, pins, fetch_key)
            if not v["ok"]:
                return {"ok": False, "reason": v["reason"]}
            to = single_address(v["to"])
            if to == "" or recipient_hash(to, owner_hex) not in allowed:
                return {"ok": False, "reason": "recipient_not_registered"}
            if token.encode() not in v["body"]:
                return {"ok": False, "reason": "receipt_token_missing"}
            return {"ok": True, "reason": "", "selector": v["selector"], "t": v["t"], "sig_hash": v["sig_hash"]}

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _handle_leader_error(leaders_res, leader_fn)
            return _canon(leaders_res.calldata) == _canon(leader_fn())

        verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        _expect(bool(verdict.get("ok")), "evidence rejected: " + str(verdict.get("reason", "")))

        t = int(verdict["t"])
        _expect(t <= now + MAX_SKEW, "signature dated in the future")
        _expect(now - t <= CLAIM_WINDOW, "message too old to claim")
        _expect(int(job.created_at) <= t < int(job.expires_at), "message outside the job's term")
        _expect(verdict["sig_hash"] not in self.signatures, "message already claimed")
        day_key = key + "|" + str(t // DAY)
        used = int(self.day_counts.get(day_key, u32(0)))
        _expect(used < int(job.daily_cap), "daily cap reached")

        self.day_counts[day_key] = u32(used + 1)
        self.signatures[verdict["sig_hash"]] = email_id
        self.claims[email_id] = Claim(job_key=key, amount=u256(price), signed_at=u64(t), selector=verdict["selector"])
        job.claimed = u64(int(job.claimed) + 1)
        self._debit(job, price)
        self.total_released = u256(int(self.total_released) + price)
        self._pay(self.payee, price)
        return {"email_id": email_id, "amount": price, "signed_at": t, "day": t // DAY}

    # ---------------------------------------------------------------- admin (delayed)

    @gl.public.write
    def propose(self, what: str, value: str) -> None:
        """what = "mailer" | "payee": takes effect via execute() after `delay` seconds."""
        self._only_admin()
        _expect(what in ("mailer", "payee"), "bad what")
        _addr(value)
        self.pending[what] = Pending(value=value, eta=u64(_now() + int(self.delay)))

    @gl.public.write
    def execute(self, what: str) -> None:
        self._only_admin()
        _expect(what in self.pending, "nothing pending")
        p = self.pending[what]
        _expect(_now() >= int(p.eta), "not ready")
        if what == "mailer":
            self.mailer = _addr(p.value)
        else:
            self.payee = _addr(p.value)
        del self.pending[what]

    @gl.public.write
    def add_key(self, selector: str, key_sha256: str) -> None:
        """Pin a new DKIM key (provider rotation). Usable for claims after `delay` seconds."""
        self._only_admin()
        self._check_key(selector, key_sha256)
        _expect(selector not in self.keys, "selector exists")
        self.keys[selector] = Pending(value=key_sha256.lower(), eta=u64(_now() + int(self.delay)))

    @gl.public.write
    def retire_key(self, selector: str) -> None:
        """Unpin a key, immediately: it can only narrow what the mailer can claim."""
        self._only_admin()
        _expect(selector in self.keys, "unknown selector")
        del self.keys[selector]

    # ---------------------------------------------------------------- views

    @gl.public.view
    def get_job(self, owner: str, job_id: str) -> dict:
        key = _job_key(_addr(owner), job_id)
        if key not in self.jobs:
            return {}
        j = self.jobs[key]
        return {
            "owner": _hex(j.owner),
            "job_id": j.job_id,
            "balance": int(j.balance),
            "daily_cap": int(j.daily_cap),
            "created_at": int(j.created_at),
            "expires_at": int(j.expires_at),
            "recipients": j.recipients.split(",") if j.recipients else [],
            "claimed": int(j.claimed),
        }

    @gl.public.view
    def claimable_today(self, owner: str, job_id: str, at: u64) -> u256:
        """Claims still allowed for the UTC day containing unix time `at`, after cap and credit."""
        key = _job_key(_addr(owner), job_id)
        if key not in self.jobs:
            return u256(0)
        j = self.jobs[key]
        used = int(self.day_counts.get(key + "|" + str(int(at) // DAY), u32(0)))
        left = max(0, int(j.daily_cap) - used)
        return u256(min(left, int(j.balance) // int(self.price)))

    @gl.public.view
    def get_claim(self, email_id: str) -> dict:
        if email_id not in self.claims:
            return {}
        c = self.claims[email_id]
        return {"job_key": c.job_key, "amount": int(c.amount), "signed_at": int(c.signed_at), "selector": c.selector}

    @gl.public.view
    def receipt_token_for(self, owner: str, job_id: str, email_id: str, template: str) -> str:
        return receipt_token(_hex(gl.message.contract_address), _hex(_addr(owner)), job_id, email_id, template)

    @gl.public.view
    def recipient_hash_for(self, email: str, owner: str) -> str:
        return recipient_hash(email, _hex(_addr(owner)))

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "admin": _hex(self.admin),
            "mailer": _hex(self.mailer),
            "payee": _hex(self.payee),
            "domain": self.domain,
            "doh_base": self.doh_base,
            "price": int(self.price),
            "delay": int(self.delay),
            "total_escrowed": int(self.total_escrowed),
            "total_released": int(self.total_released),
            "keys": {s: {"sha256": p.value, "active_from": int(p.eta)} for s, p in self.keys.items()},
            "pending": {w: {"value": p.value, "eta": int(p.eta)} for w, p in self.pending.items()},
            "templates": list(TEMPLATES),
        }

    # ---------------------------------------------------------------- internals

    def _only_admin(self) -> None:
        _expect(gl.message.sender_address == self.admin, "only admin")

    def _owned(self, job_id: str) -> Job:
        key = _job_key(gl.message.sender_address, job_id)
        _expect(key in self.jobs, "unknown job")
        return self.jobs[key]

    def _cap(self, cap: int) -> int:
        c = cap if cap else DEFAULT_DAILY_CAP
        _expect(0 < c <= MAX_DAILY_CAP, "bad daily_cap")
        return c

    def _recipients(self, hashes: list[str]) -> str:
        hs = [h.strip().lower() for h in hashes]
        _expect(0 < len(hs) <= MAX_RECIPIENTS, "1 to 3 recipients")
        for h in hs:
            _expect(_HEX64.match(h) is not None, "recipient must be a sha256 hex")
        _expect(len(set(hs)) == len(hs), "duplicate recipient")
        return ",".join(hs)

    def _check_key(self, selector: str, key_sha256: str) -> None:
        _expect(_SELECTOR.match(selector) is not None, "bad selector")
        _expect(_HEX64.match(key_sha256.strip().lower()) is not None, "bad key_sha256")

    def _debit(self, job: Job, amount: int) -> None:
        job.balance = u256(int(job.balance) - amount)
        self.total_escrowed = u256(int(self.total_escrowed) - amount)

    def _pay(self, to: Address, amount: int) -> None:
        # External message to an EOA on the chain layer; executes when this tx finalizes.
        _Wallet(to).emit_transfer(value=u256(amount))
