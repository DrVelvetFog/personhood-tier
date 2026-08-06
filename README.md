# personhood-tier

**A third assurance tier for attestation systems: device attestation proves the hardware is genuine — a personhood credential caps accounts-per-human.**

Wallet/device trust ladders top out at `attested`: an Apple App Attest or Play Integrity
verdict proves *a genuine device is running a genuine app*. What it cannot give you is a
stable per-device — let alone per-person — identity, so a farm with N real phones (or one
phone cycled through reinstalls and UI automation) earns `attested` on M ≫ N accounts.
Every per-device mitigation (receipt risk metrics, device-key registries, key-count
telemetry) moves the *constant* of that attack; none changes its *unit*. The abuse is
priced in device-hours.

This demo composes a third tier that changes the denominator:

| tier | proves | leg in this demo |
|---|---|---|
| `wallet` | caller controls an EVM key (SIWE) | **real** |
| `attested` | genuine device + genuine app | **stub** (see below) |
| `attested+person` | + holder of an on-chain [PoR](https://por-proof-of-real.netlify.app) credential | **real** — live read from Sui testnet |

A gated resource keyed on the person credential admits **one claim per human**, however
many wallets or devices that human controls.

## Run it

```sh
npm install
npm run demo
```

Expected output (abridged):

```
── Act 1 · attested tier only (today's ceiling) ──────────────
  farm wallet #1 → claim ✓ PAID (keyed by wallet)
  farm wallet #2 → claim ✓ PAID (keyed by wallet)
  ⇒ cost scales with device-hours, not humans.

── Act 2 · attested+person (the denominator change) ──────────
  wallet A + PoR 0x8a77… (L0) → claim ✓ PAID
  wallet B + PoR 0x8a77… (L0) → claim ✗ already_claimed
  ⇒ two wallets, two (stub-)attested devices, ONE human, ONE claim.
```

Act 2 needs a Sui keypair holding a testnet PoR credential; the first run creates
`demo/.demo-sui.key` and prints what's missing. (PoR operators can mint one with
`demo/mint.mjs`.)

## The binding is the load-bearing part

A personhood credential that isn't **bound to the session** is just a rentable object —
the same replay trap App Attest falls into when the account isn't bound into
`clientDataHash`. So the person tier here requires the Sui wallet to sign a
server-issued, single-use challenge that names the EVM session it upgrades:

```
por-bind:v1:<evm-address>:<sui-address>:<nonce>
```

The server only accepts the proof if the signature recovers to `sui-address`, the nonce
is the fresh one it issued to *this* session, and the credential passes the on-chain
check (level + expiry). A stale or unbound proof is refused — verified by the demo's
abuse checks (wrong-address binding → 401, missing challenge → 401).

The composed session claim:

```json
"att": {
  "tier": "attested+person",
  "person": { "level": 0, "cred": "0x530192ce…", "chain": "sui:testnet" }
}
```

## What's real, what's stubbed

**Real:** SIWE session auth; the PoR credential read (live Sui testnet, over gRPC — see
`src/grpcSuiAdapter.mjs`; public JSON-RPC was retired in mid-2026, so the adapter serves
por-sdk's reads from the same fullnode's gRPC endpoint); the challenge binding; the
claim-keying logic.

**Stubbed:** the `attested` tier. `/session/attest` grants it unconditionally and says so
in its response. Real integration means verifying an App Attest assertion or Play
Integrity verdict server-side, with three disciplines that mirror this demo's own PoR
leg: bind the account into the attested challenge; treat device dedup as a rate-limiter,
not a uniqueness set (attest keys don't survive app delete/restore); and run any dedup in
observe mode before enforcing.

**Skipped:** the revocation devInspect (`checkRevocation: false`) until por-sdk's
transport migration lands — a freshly minted demo credential is not revoked. Level and
expiry are enforced from chain state.

## What this does — and does not — claim

This demonstrates a **composition mechanism**, not a deployed Sybil-resistant system.
Proof-of-personhood has its own costs and failure modes, and the L0 credential used by
the demo attests *genuine device + live human*, *not* uniqueness — a production gate
would require L2+ (real-world-action history) or an explicit uniqueness proof. The
argument this repo makes is narrower and, we think, sturdier: whatever strength your
personhood layer has, **composing it above the attested tier is what changes the abuse
unit from device-hours to humans** — and that composition is cheap, incremental, and
doesn't touch the attestation layer's trust model.

## Natural integration points (not built here)

- **Quota-scaled rewards / gas sponsorship** — tiers map to reward-claim rights or
  sponsored-transaction quotas (e.g. a paymaster granting `attested+person` a higher
  free tier).
- **402 overage** — sessions that exhaust their tier's free quota fall through to
  HTTP 402 per-use payment instead of a hard cap.

## Appendix: mapping to Nodle's trust-relay

This demo generalizes a discussion in NodleCode/trust-relay —
[#19](https://github.com/NodleCode/trust-relay/issues/19) documents the
wallets-per-device gap (no stable device identifier in either App Attest or Play
Integrity), and [#17](https://github.com/NodleCode/trust-relay/issues/17) covers the
attested-tier pitfalls the stub notes above summarize. In trust-relay terms: the ladder
here is `wallet → attested → attested+person`, the composed claim extends the session's
`att` claims, and the `/claim` route stands in for any quota- or reward-bearing action.
No affiliation implied — this is an independent demo of the composition.

## License

MIT
