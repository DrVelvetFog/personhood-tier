// personhood-tier — a third assurance tier for attestation systems.
//
// Tier ladder (mirrors the wallet/attested shape of attestation relays):
//
//   wallet            SIWE: caller controls an EVM key            (real)
//   attested          device attestation passed                   (STUB — see below)
//   attested+person   + holder of an on-chain PoR credential      (real, Sui testnet)
//
// The point of the demo is the denominator: every per-device primitive prices
// abuse in device-hours, so quota keyed on wallet or device is farmable by
// cycling N real phones across M wallets. A personhood credential changes the
// unit — /claim keyed on the person credential admits one claim per human, no
// matter how many wallets or devices that human controls.
//
// ⚠ The device-attestation leg is a STUB. Real App Attest / Play Integrity
// verification needs a shipped app and (crucially) challenge binding of the
// wallet address into clientDataHash — the same binding discipline this demo
// applies to its own PoR leg. See README "What's real, what's stubbed".
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { SiweMessage, generateNonce } from 'siwe';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { checkPerson, MIN_LEVEL, VERIFY_URL } from './por.mjs';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || randomBytes(32).toString('hex'),
);
const NONCE_TTL_MS = 5 * 60_000;
const BIND_PREFIX = 'por-bind:v1';

export function createApp() {
  const app = express();
  app.use(express.json());

  const siweNonces = new Map(); // nonce -> expiresAt
  const bindNonces = new Map(); // jti   -> { nonce, expiresAt }
  const claims = new Map();     // key   -> { sub, at }

  const issue = async (sub, att) =>
    new SignJWT({ att })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(JWT_SECRET);

  const auth = async (req, res, next) => {
    const token = (req.header('authorization') || '').replace(/^Bearer /, '');
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      req.session = payload;
      next();
    } catch {
      res.status(401).json({ error: 'missing or invalid session token' });
    }
  };

  // ── Tier 1: wallet (SIWE) ────────────────────────────────────────────────
  app.get('/session/nonce', (_req, res) => {
    const nonce = generateNonce();
    siweNonces.set(nonce, Date.now() + NONCE_TTL_MS);
    res.json({ nonce });
  });

  app.post('/session', async (req, res) => {
    const { message, signature } = req.body ?? {};
    if (!message || !signature) return res.status(400).json({ error: 'message and signature required' });
    let siwe;
    try {
      siwe = new SiweMessage(message);
      await siwe.verify({ signature });
    } catch {
      return res.status(401).json({ error: 'SIWE verification failed' });
    }
    const expiresAt = siweNonces.get(siwe.nonce);
    if (!expiresAt || expiresAt < Date.now()) {
      return res.status(401).json({ error: 'unknown or expired nonce' });
    }
    siweNonces.delete(siwe.nonce); // single use
    const sub = siwe.address.toLowerCase();
    res.json({ token: await issue(sub, { tier: 'wallet' }) });
  });

  // ── Tier 2: attested (STUB) ──────────────────────────────────────────────
  // A real relay verifies an Apple App Attest assertion or a Play Integrity
  // verdict here. This demo grants the tier unconditionally so the composition
  // above it can be exercised — the response says so, loudly.
  app.post('/session/attest', auth, async (req, res) => {
    const { sub, att } = req.session;
    if (att.tier !== 'wallet') return res.status(409).json({ error: `cannot attest from tier '${att.tier}'` });
    res.json({
      token: await issue(sub, { tier: 'attested' }),
      stub: true,
      note: 'Device attestation is STUBBED in this demo. Nothing about genuine hardware has been proven.',
    });
  });

  // ── Tier 3: attested+person (real, on-chain) ─────────────────────────────
  // Challenge binding: the Sui wallet must sign a server-issued nonce that
  // includes the EVM address — a stale or unbound personhood proof would be
  // rentable across sessions, the exact replay trap App Attest has when the
  // wallet address isn't bound into clientDataHash.
  app.post('/session/person/challenge', auth, (req, res) => {
    const { sub, att, jti } = req.session;
    if (att.tier !== 'attested') return res.status(409).json({ error: `person tier requires tier 'attested', have '${att.tier}'` });
    const nonce = randomBytes(16).toString('hex');
    bindNonces.set(jti, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });
    res.json({
      nonce,
      message: `${BIND_PREFIX}:${sub}:<your-sui-address>:${nonce}`,
      note: 'Sign this with the Sui wallet holding your PoR credential (personal message).',
    });
  });

  app.post('/session/person', auth, async (req, res) => {
    const { sub, att, jti } = req.session;
    if (att.tier !== 'attested') return res.status(409).json({ error: `person tier requires tier 'attested', have '${att.tier}'` });
    const { suiAddress, signature } = req.body ?? {};
    if (!suiAddress || !signature) return res.status(400).json({ error: 'suiAddress and signature required' });

    const entry = bindNonces.get(jti);
    if (!entry || entry.expiresAt < Date.now()) return res.status(401).json({ error: 'no fresh binding challenge — call /session/person/challenge first' });

    const message = `${BIND_PREFIX}:${sub}:${suiAddress}:${entry.nonce}`;
    try {
      const pk = await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature);
      if (pk.toSuiAddress() !== suiAddress) return res.status(401).json({ error: 'signature/address mismatch' });
    } catch {
      return res.status(401).json({ error: 'bad Sui signature over binding challenge' });
    }
    bindNonces.delete(jti); // single use

    const person = await checkPerson(suiAddress);
    if (!person) {
      return res.status(403).json({
        error: `no PoR credential at level >= ${MIN_LEVEL} for ${suiAddress}`,
        verifyUrl: VERIFY_URL,
      });
    }
    res.json({ token: await issue(sub, { tier: 'attested+person', person }), person });
  });

  // ── The gated resource: a reward claim ───────────────────────────────────
  // Shaped like a network grant/reward claim. The key line is the denominator:
  // with a person credential the claim is keyed per-HUMAN; without it, the best
  // available key is the wallet — which a device farm multiplies at will.
  app.post('/claim', auth, (req, res) => {
    const { sub, att } = req.session;
    if (att.tier === 'wallet') return res.status(403).json({ error: 'claim requires at least the attested tier' });

    const key = att.person ? `person:${att.person.cred}` : `wallet:${sub}`;
    if (claims.has(key)) {
      return res.status(409).json({ error: 'already_claimed', keyedBy: att.person ? 'person-credential' : 'wallet', key });
    }
    claims.set(key, { sub, at: Date.now() });
    res.json({
      ok: true,
      keyedBy: att.person ? 'person-credential' : 'wallet',
      key,
      farmable: !att.person,
      note: att.person
        ? 'Keyed on the PoR credential: one claim per human, however many wallets or devices they control.'
        : 'Keyed on the wallet: N wallets on cycled real devices = N claims. Cost scales with device-hours, not humans.',
    });
  });

  return app;
}

export function startServer(port = 0) {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log('⚠ demo service: the device-attestation tier is a STUB (see README)');
      resolve({ server, url: `http://localhost:${server.address().port}` });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startServer(Number(process.env.PORT || 8790));
  console.log(`personhood-tier demo service listening at ${url}`);
}
