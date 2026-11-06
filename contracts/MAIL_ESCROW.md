# MailEscrow: email fees released against proof of sending

> **NOT AUDITED. TESTNET ONLY.** `contracts/src/mail_escrow.py` has had no external review and has
> never run on a live network. Do not deposit anything you can't lose.

Owner model (Ivan, 2026-11-02): the mailer is a **project wallet**. It earns the email fees and sends
mail off-chain. Users put GEN in escrow as email credit. The fee for one email is released to the
project wallet only after the mailer shows evidence that the email was sent, and GenLayer consensus
checks that evidence.

This replaces "charge before send" (`docs/PRODUCT.md` §11.2, `lib/mailer/charger.ts` on
`feature/uptime-mailer`) with **send, then claim against evidence**. `UptimePool.sol` stays as it is.
It still pays the scheduler's run gas (role 1). Its mailer role (2) is no longer needed for email.

---

## 1. Evidence options

The question is what the mailer can show that validators can check **on their own**, without
trusting the mailer.

| Option | What validators can check themselves | What it proves | Trust left | Verdict |
|---|---|---|---|---|
| **(a) Postmark API** (`GET /messages/outbound/{id}/details`: `Status`, the `Delivered` event with the recipient MX's SMTP reply) | Nothing. Every Postmark read needs `X-Postmark-Server-Token`. Putting that token in a contract or in calldata publishes it, and then anyone can send mail as us | Delivered to the recipient's MX (Postmark's word) | All of it. Validators cannot fetch this | **Not possible** directly. Relaying it puts us back at (b) |
| **(b) Our own evidence endpoint** (`GET /api/evidence/{emailId}` → `{sent: true}`) | That our server says so | Only that we say so | **All of it.** The payee vouches for itself. That makes it a self-attestation, not an escrow condition | **Rejected.** It only adds consensus cost on top of trust in us |
| **(c) DKIM-signed raw message** (the `.eml` as it left the provider, checked against the sending domain's DKIM key) | The RSA-SHA256 signature over the signed headers (From, **To**, Subject, Date) and the **whole body**. The key comes from public DNS and must match a key pinned on-chain. Recipient, template and timestamp all come from signed bytes | **Sent:** the holder of the DKIM private key (the provider) signed a message with exactly these headers and this body, addressed To: this recipient, at time `t` | Who holds the key. Header To vs. SMTP envelope. DNS and the pin list are ours. See §5 | **Chosen** |
| **(d) Recipient acknowledgement** (a link in the email signs a receipt when clicked) | A signature or click record, if a recipient-side key exists. In practice that means "our server logged a click", which is (b) again | **Read**, by someone who had the email | Our click log, unless the recipient signs with a wallet | **Not a payment condition.** Alert mail is mostly not clicked, so the mailer would go unpaid for real work. Keep it as an optional "read" signal later |
| **(e) Combinations** (c)+(a) or (c)+(d) | (c) as above. The (a)/(d) part is still only our word | Sent (c) plus delivered or read (our claim) | As (c), plus us for the extra part | (c) is the condition. Delivery and read status can be shown in the UI, never used to gate payment |

### What GenVM can actually do (checked, not assumed)

- **SHA-256:** the Python runner `py-genlayer:babwp9t…` (Bradbury, GenVM v0.6.0-rc10) uses CPython
  `3t4hs1ey…`. That build ships `hashlib.py`, and the SHA-2 C code is compiled into
  `cpython.det.wasm` (`strings` finds `Hacl_Hash_SHA2`). So `hashlib.sha256` is native, not pure
  Python; the Heartbeat's `card.png` sha256 check ran on Bradbury's GenVM in a `gen_call` deploy
  simulation (2026-11-03). The GenLayer
  docs' randomness example (`features/random`) also calls `hashlib.sha256`.
- **RSA verify:** this is Python big integers plus `pow(s, e, n)`. With e = 65537 a 2048-bit check
  is 17 modular squarings, which is cheap. No library is needed. `rsa_sha256_verify` is about 10
  lines (EMSA-PKCS1-v1_5 per RFC 8017 §9.2). The SPKI/PKCS#1 key is parsed by a 20-line DER reader.
- **DNS:** GenVM has no raw DNS. DNS-over-HTTPS JSON (`https://dns.google/resolve?name=…&type=TXT`)
  through `gl.nondet.web.get` returns `{"Status":0,"Answer":[{"type":16,"data":"v=DKIM1; k=rsa; p=…"}]}`.
  NXDOMAIN is `"Status":3`. Both shapes were checked against dns.google on 2026-11-02, and
  `headers=` is supported for Cloudflare's `accept: application/dns-json`.
- **No LLM.** DKIM verification is mechanical. An LLM would only add disagreement and a
  prompt-injection surface, because the evidence is attacker-chosen text.
- **Correctness:** the verifier passes the published **RFC 8463 Appendix A rsa-sha256 vector**: a
  real 1024-bit key, relaxed/relaxed, over-signed headers. Tampering with the body or the To header
  of that vector fails as it should (`test_rfc8463_rsa_vector_verifies`).

---

## 2. Where the escrow lives: in the intelligent contract

GenLayer intelligent contracts hold and move native GEN (docs: *Intelligent Contracts → Features →
Value Transfers*):
- `@gl.public.write.payable` methods receive GEN, and `gl.message.value` is the `u256` sent.
- `_Wallet(addr).emit_transfer(value=…)`, with `@gl.evm.contract_interface`, pays an EOA on the
  chain layer. It goes out as an external message through the contract's ghost contract and
  **executes only when the transaction finalizes**. The value leaves the contract balance at once.
  In the SDK this is an `EthSend` with empty calldata (`genlayer/gl/_internal/eth.py:59`).

**Choice: one intelligent contract holds the credit and pays out.** Users deposit straight into it.
A verified claim pays the project wallet in the same transaction.

The rejected alternative is to keep the money in `UptimePool.sol` and relay a GenLayer verdict. The
IC would emit `UptimePool.release(...)` to the EVM contract on finalization, and the pool would trust
the IC's ghost address as a new "verifier" role. That costs a Solidity change, a new trust edge
(ghost address → pool), two contracts to deploy and keep in sync, and a cross-layer message per
email. It buys nothing the IC cannot do alone. Its only advantage, one deposit for runs and email
together, is a UX point that a later version can win back.

Caveats on this choice:
- **Not proven live on Bradbury.** No transaction was sent for this work. The first deploy should
  be a smoke test: `open_job` with 0.05 GEN, one `withdraw`, and a check that the EOA balance moved
  after finalization (§8).
- Payouts arrive at **finalization**, not acceptance. An appeal that changes the result also
  changes the transfer, because messages are emitted only from the final result.
- The contract keeps its own ledger (`total_escrowed`, per-job `balance`). It does not rely on
  `self.balance`.

---

## 3. The scheme

```
owner (wallet)                 mailer (project hot key)            MailEscrow (Bradbury IC)
 open_job(job, [rh], cap, ttl) ──────────────────────────────────▶ escrow GEN for (owner, job)
                               send alert via Postmark:
                                 To: owner's verified address
                                 body line "Receipt: uptime-receipt-v1-<32 hex>"
                               obtain the DKIM-signed raw .eml
                               publish it at https://…/<emailId>-<sha>   (short-lived)
                               claim(owner, job, emailId, "alert",
                                     url, sha256(eml)) ─────────────▶ each validator:
                                                                     GET url, sha256 must match
                                                                     GET DoH TXT s._domainkey.d
                                                                     sha256(DER key) == pinned key
                                                                     DKIM verify (RSA-SHA256)
                                                                     signed To ∈ job recipients
                                                                     body has this receipt token
                                                                   then, deterministic:
                                                                     t within window, cap per day,
                                                                     no replay; debit; pay payee
```

**Binding.** Each of the following comes from bytes the provider signed:
- **Recipient:** the one `To:` header must be signed (`h=` includes `to`). The message may have
  exactly one `To:` and one `From:`. The address must hash to one of the job's
  `recipient_hash(email, owner) = sha256(lower(email) + "|" + lower(owner))`, which the owner
  registered on-chain.
- **Job, email, template:** `receipt_token = "uptime-receipt-v1-" + sha256("uptime-mail-escrow/v1|"
  + contract | owner | job_id | email_id | template)[:32]` must appear in the signed body. It
  contains only hex and `-`, so quoted-printable leaves it intact. It names the contract, so a
  message cannot be replayed into another deployment.
- **Time:** DKIM `t=` (required) sets the UTC day used by the daily cap and the claim window.
- **Whole body:** an `l=` (body length) tag is refused, because it would let unsigned text be
  appended after the signed part.

---

## 4. Contract API (`contracts/src/mail_escrow.py`)

Deploy: `MailEscrow(mailer, payee, domain, selector, key_sha256, price, delay, doh_base)`. The deployer
becomes `admin`.

| Method | Who | What |
|---|---|---|
| `open_job(job_id, recipients[], daily_cap, ttl)` **payable** | owner | Creates the escrow for (caller, job_id) and deposits `msg.value`. `recipients` = 1–3 recipient hashes. `daily_cap` 0 means 10 (max 100). `ttl` 0 means 90 days (max 365) |
| `top_up(job_id)` **payable** | owner | Adds credit. Refused after expiry |
| `set_job(job_id, recipients[], daily_cap, expires_at)` | owner | Replaces recipients and cap, and moves the expiry (≤ now + 365 days; a past value expires the job now) |
| `withdraw(job_id, amount)` | owner | **Immediate.** 0 means everything. Pays the owner |
| `refund_expired(owner, job_id)` | anyone | After expiry, pushes the remaining credit to the owner (never to the caller) |
| `claim(owner, job_id, email_id, template, evidence_url, evidence_sha256)` | mailer | Verifies (§3). On success: debits `price`, records the claim, pays `payee`. Any failure reverts with `[EXPECTED] evidence rejected: <reason>` or a specific `[EXPECTED]` rule |
| `propose("mailer"\|"payee", addr)` → `execute(what)` | admin | Rotation, effective after `delay` |
| `add_key(selector, key_sha256)` / `retire_key(selector)` | admin | Pin a new DKIM key (usable after `delay`) or unpin one at once |
| `get_job`, `get_claim`, `claimable_today(owner, job, at)`, `get_config` | view | `claimable_today` = min(cap left for that UTC day, credit / price) |
| `receipt_token_for(owner, job, email_id, template)`, `recipient_hash_for(email, owner)` | view | The exact strings the mailer and UI must produce |

Claim checks, in order:
1. Deterministic pre-checks: caller is the mailer, `email_id` not yet claimed, template is in
   `("alert",)`, https URL, a 64-hex sha, the job exists and has not expired, credit ≥ price.
2. Non-deterministic, run by every validator and compared with a custom validator
   (`run_nondet_unsafe`; the verdict must match exactly): fetch the evidence, check its hash, fetch
   the key over DoH, check the key pin, verify DKIM, check the recipient and the token.
3. Deterministic post-checks on the signed `t`: `t ≤ now + 10 min`, `now − t ≤ 7 days`,
   `created_at ≤ t < expires_at`. Also: the signature hash has not been used before, and fewer than
   `daily_cap` claims exist for that day.

Error prefixes follow the repo convention. `[EXPECTED]` means a business rule and must match
exactly. `[EXTERNAL]` means evidence or DNS returned 4xx. `[TRANSIENT]` means 5xx/429, an
ambiguous DNS answer or SERVFAIL; validators agree when both see it. A content verdict such as
`bad_signature` is a value, not an error, so validators compare it exactly.

---

## 5. Trust that remains (be explicit with users)

1. **Who holds the DKIM private key.** The scheme is sound only if the **provider** generated and
   holds the key: Postmark's DKIM setup for a custom domain does this, and we only publish the
   public half. If we ever sign with a key we hold, the mailer can forge evidence offline and the
   escrow is back to (b). **The chain cannot tell who generated a key.** Key provenance is an
   off-chain claim we make, and anyone can check the DNS history.
2. **Header To vs. SMTP envelope.** DKIM covers the `To:` *header*. Over Postmark's SMTP relay, a
   dishonest mailer could send a message whose header says `To: alice` while the envelope reaches
   only the evidence mailbox. Even so, it can only claim for mail it really pushed through
   Postmark, addressed to an owner-registered recipient, within the owner's daily cap. The HTTP API
   that `lib/mailer` uses has no separate envelope (To and Bcc are the envelope), but the contract
   cannot tell which interface was used.
3. **"Sent", not "delivered" or "read".** A valid claim proves the provider signed the message. It
   does not prove the recipient's server accepted it.
4. **We control DNS and the pin list.** That is why the key hash is **pinned on-chain** and the DNS
   fetch only confirms it. A new key is usable only after `delay` (set it to 48 h for anything
   real), so owners can see it in `get_config().keys` and withdraw first. Unpinning takes effect at
   once, because it can only narrow what the mailer can claim. The same delay covers changing
   `mailer` and `payee`. The admin **cannot** move, freeze or redirect any job's credit, raise any
   cap or change the price.
5. **Privacy.** The raw `.eml` holds the recipient's address, the job name and the unsubscribe
   link. It is never written on-chain: calldata carries only its URL and sha256, and the stored
   verdict carries no content. But **anyone who reads the claim's calldata can fetch the URL while
   it is live.** Keep it live only until the claim finalizes plus the appeal window, then delete it
   (404). The recipient hash is salted with the owner's wallet but can be brute-forced against a
   guessed address. A future version could use a ZK DKIM proof (zk-email style) to hide headers.
   Verifying a Groth16 proof inside GenVM is untested and probably expensive.
6. **Withdraw race.** Mail is sent before it is paid, and owners may withdraw at once. A mailer that
   sends while an owner is withdrawing loses that one fee. The mailer checks
   `claimable_today` and the credit just before sending. There is no reservation step: it would
   cost a second GenLayer tx per email and lock the owner's money.
7. **Evidence availability.** If the evidence host or DoH is down, claims fail with `[TRANSIENT]`
   and can be retried within the 7-day window. The owner's money is never at risk from this.
8. **Unaudited code.** This is a hand-written DKIM verifier and escrow. Testnet only.

---

## 6. Mailer-side sketch (not implemented; `lib/mailer` untouched)

What changes on `feature/uptime-mailer` (`frontend/src/lib/mailer/*`):

1. **No charge before send for Bradbury.** In `policy.ts` `sendOne`, step 10 (CHARGE) becomes a
   **pre-check**: `readContract claimable_today(owner, job, now)` ≥ 1, `get_job` balance ≥ price,
   and the job's `recipients` contains `recipientHash(email, owner)`. If any check fails, refuse with
   `refused: escrow`. Keep the DB caps (`perJobPerDay`) at or below the job's on-chain `daily_cap`,
   so we never send mail we cannot be paid for.
2. **Receipt line in the template.** `templates.ts` `alertMessage(…)` takes a `receipt` argument and
   adds `Receipt: ${receipt}` to the text part (and to the HTML part, in `<code>`). Computed locally:
   ```ts
   const receipt = "uptime-receipt-v1-" + sha256hex(
     ["uptime-mail-escrow/v1", ESCROW.toLowerCase(), owner.toLowerCase(), jobId, String(row.id), "alert"].join("|")
   ).slice(0, 32);
   // must equal readContract("receipt_token_for", [owner, jobId, String(row.id), "alert"])
   const recipientHash = sha256hex(email.trim().toLowerCase() + "|" + owner.toLowerCase());
   ```
   `email_id` is the ledger row id, as `settlementId` is today.
3. **Obtain the signed raw message.** Two paths. Test both, then keep one (§8):
   - **Postmark dump:** `GET /messages/outbound/{MessageID}/dump` (server token) returns the raw
     source. This is usable **only if** the dump includes the final `DKIM-Signature: d=<our domain>`
     header. Unknown until tried.
   - **BCC evidence mailbox:** `Bcc: evidence@<our domain>` on every alert (Postmark signs once; the
     BCC copy carries the same signature). The mailer reads the raw message back over IMAP. This
     is an inbound path. It stays within §11.1's rule because nothing from the mailbox is trusted:
     the contract trusts only the DKIM signature, never `From:`.
4. **Publish, then claim** (a new `escrow.ts`, replacing `charger.ts` for Bradbury): put the raw
   bytes at a content-addressed, unguessable URL (Vercel Blob, private-by-obscurity:
   `…/evidence/<emailId>-<sha256[:16]>-<random>.eml`), then `writeContract claim(owner, jobId,
   String(row.id), "alert", url, sha256)` signed with `MAILER_KEY` (now a GenLayer account, not a
   pool spender). Claims are async like the heartbeat tick: submit in the send path, settle in
   `reconcile`.
5. **Reconcile.** Read the tx result. `ACCEPTED` or `FINALIZED` with a return value means
   `claimed` (store the tx hash on the row). A revert means `claim_refused:<reason>`, with an alert
   to us: it is either a bug or tampering. Once finalized and the appeal window has passed, delete
   the evidence blob.
6. **UI.** The deposit form computes `recipientHash` for the owner's verified addresses (max 3, D18)
   and calls `open_job` from the owner's wallet. Show `claimed` per email with a link to the tx.
   `MAX_RECIPIENTS_PER_WALLET = 3` already matches the contract's limit.
7. Migration: add `escrow_claim_tx`, `evidence_url` and `claim_outcome` to the alerts ledger, and
   add `claimed` / `claim_refused` to its outcome vocabulary. Update `INTEGRATIONS.md` (Postmark
   dump or IMAP, Blob, GenLayer RPC claim) in the same commit.

---

## 7. Tests

`test/direct/test_mail_escrow.py` (direct mode, about 1 s). Messages are signed with real 2048-bit
RSA keys (pycryptodome) by an independent test signer. The verifier is also checked against the
RFC 8463 vector, so a bug shared by the signer and the verifier cannot hide. Transfers are captured
through the direct VM's `gl_call` hook (`EthSend`).

- **Real-world vector:** RFC 8463 rsa-sha256 verifies. A changed body gives `body_hash_mismatch`;
  a changed To gives `bad_signature`.
- **Happy path:** relaxed/relaxed, simple/simple and LF-only `.eml`. The fee goes to the payee and
  the ledger totals add up.
- **Forged:** attacker key served from DNS gives `dns_key_not_pinned_key`. Wrong signing key with
  the real DNS key gives `bad_signature`. Wrong `d=` gives `no_signature_for_domain`. Unpinned
  selector, a key not yet active, a revoked key (`p=`) and NXDOMAIN are each refused. An `l=` tag
  is refused, and so are unsigned From/To. An extra unsigned To header is refused. A
  tampered body or To is refused.
- **Mismatched:** wrong evidence sha, recipient not registered, more than one recipient, a token for
  another email or job, an uncharged template.
- **Replay:** the same `email_id` again gives `email already claimed`, and only one payout happens.
- **Caps and time:** cap 2 refuses the third claim of the day and allows one the next day. Default
  cap is 10, bounds hold, and future, pre-deposit or stale signatures are refused.
- **Money:** immediate full and partial withdraw, top-up, claims stopping after withdraw,
  non-owners unable to withdraw, expiry stopping claims, refunds going only to the owner.
- **Consensus:** the validator agrees on an identical world, and **disagrees** when its DNS shows a
  different key. Evidence 503 gives `[TRANSIENT]`; 404 gives `[EXTERNAL]`.
- **Admin:** rotation and new keys wait for `delay`, and retiring a key is immediate.

```bash
contracts/verify.sh     # both builds (bradbury, studio): direct tests + genvm-lint; see contracts/README.md
```

Not covered: real consensus (integration tests on Studio/Bradbury), real Postmark output, and the
live value-transfer path.

---

## 8. What Ivan must provide or decide

1. **Sending domain + Postmark DKIM.** The `From:` domain (e.g. `uptime.genlayer.foundation`) must be
   verified in Postmark with **Postmark-generated** DKIM. Give the selector (Postmark's look like
   `20261102123456pm`) and pin the key:
   ```bash
   curl -s "https://dns.google/resolve?name=<selector>._domainkey.<domain>&type=TXT" \
     | jq -r '.Answer[0].data' | tr -d '" ' | sed 's/.*p=//' | base64 -d | shasum -a 256
   ```
   **If the provider is Resend** (the Foundation account the portal already uses, now supported
   by the mailer as `MAILER_PROVIDER=resend`): domain `genlayer.foundation`, selector `resend`,
   a Resend-generated RSA-1024 key (the verifier handles 1024; the RFC 8463 vector is 1024), key
   sha256 `c394e4673d3dcd6b71a9c94590761ad39af052c852fadbe39a30affc147e757b` as of 2026-11-06.
   Resend holds the private half, so provenance (§5.1) holds. That key also signs the portal's
   mail; the escrow still binds recipient and receipt token from signed bytes, but a dedicated
   `uptime.genlayer.foundation` domain in Resend would give Uptime its own key. Resend exposes no
   raw-source API, so step 3 must use the **BCC evidence mailbox** (`genlayer.foundation` MX is
   Google Workspace).
2. **One real test email** through the production Postmark stream, to confirm: the signature has
   `d=<our domain>` (not only `pm.mtasv.net`), `h=` includes `to`, there is no `l=`, the text part is
   quoted-printable or 7bit (the receipt token must appear literally; base64 parts would hide it),
   and whether the outbound **dump** API includes that `DKIM-Signature`. If it does not, set up the
   BCC evidence mailbox.
3. **Addresses and numbers:** the `mailer` key (claims), the `payee` project wallet (may be the
   same), `price` in wei (it is fixed per deployment; redeploy to change it), `delay` (suggest 48 h;
   tests use 1 h), and `doh_base` (`https://dns.google/resolve`, or Cloudflare
   `https://cloudflare-dns.com/dns-query`).
4. **Evidence hosting and retention:** where the `.eml` lives (Vercel Blob?), and accepting the
   privacy window in §5.5 for testnet.
5. **A live smoke test on Bradbury** (not done here, as no transactions were sent): deploy, then
   `open_job` with 0.05 GEN, `withdraw`, and check the EOA balance after finalization. This confirms
   payable and `emit_transfer` to an EOA work on 4221 before anyone deposits.
6. **Product decision:** this replaces D16 (charge before send) with send-then-claim for Bradbury
   email, and moves email credit out of `UptimePool` (role 2 becomes unused).
