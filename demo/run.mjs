// End-to-end demo, two acts:
//
//   Act 1 — the farm.   Two wallets, attested tier only. Both claim. This is
//           trust-relay#19's economics: claims keyed per-wallet/device are
//           priced in device-hours.
//   Act 2 — the fix.    Two wallets, both bound to the SAME PoR credential
//           (one human). First claim lands; second is refused. The denominator
//           is now the human.
//
// Needs a Sui keypair holding a testnet PoR credential. First run creates
// demo/.demo-sui.key and prints the mint command if the credential is missing.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { SiweMessage } from 'siwe';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { startServer } from '../src/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(here, '.demo-sui.key');

const api = (url) => async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(url + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
};

function suiKeypair() {
  if (existsSync(KEY_FILE)) {
    const { secretKey } = decodeSuiPrivateKey(readFileSync(KEY_FILE, 'utf8').trim());
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  const kp = new Ed25519Keypair();
  writeFileSync(KEY_FILE, kp.getSecretKey(), { mode: 0o600 });
  return kp;
}

// wallet tier (SIWE) + attested tier (stub) for a fresh EVM wallet
async function attestedSession(call) {
  const wallet = Wallet.createRandom();
  const { body: { nonce } } = await call('/session/nonce');
  const message = new SiweMessage({
    domain: 'localhost',
    address: wallet.address,
    statement: 'personhood-tier demo',
    uri: 'http://localhost',
    version: '1',
    chainId: 1,
    nonce,
  }).prepareMessage();
  const signature = await wallet.signMessage(message);
  const session = await call('/session', { method: 'POST', body: { message, signature } });
  if (session.status !== 200) throw new Error(`SIWE session failed: ${JSON.stringify(session.body)}`);
  const attested = await call('/session/attest', { method: 'POST', token: session.body.token });
  return { wallet, token: attested.body.token };
}

// person tier: sign the server's binding challenge with the Sui key
async function personSession(call, { wallet, token }, suiKp) {
  const suiAddress = suiKp.getPublicKey().toSuiAddress();
  const { body: { nonce } } = await call('/session/person/challenge', { method: 'POST', token });
  const message = `por-bind:v1:${wallet.address.toLowerCase()}:${suiAddress}:${nonce}`;
  const { signature } = await suiKp.signPersonalMessage(new TextEncoder().encode(message));
  return call('/session/person', { method: 'POST', token, body: { suiAddress, signature } });
}

const short = (a) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const jwtPayload = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

const { server, url } = await startServer();
const call = api(url);
const suiKp = suiKeypair();
const suiAddress = suiKp.getPublicKey().toSuiAddress();

console.log(`\ndemo Sui identity (the one human): ${short(suiAddress)}`);

// ── Act 1: the farm ────────────────────────────────────────────────────────
console.log('\n── Act 1 · attested tier only (today\'s ceiling) ──────────────');
for (const name of ['farm wallet #1', 'farm wallet #2']) {
  const s = await attestedSession(call);
  const claim = await call('/claim', { method: 'POST', token: s.token });
  console.log(`  ${name} ${short(s.wallet.address.toLowerCase())} → claim ${claim.status === 200 ? '✓ PAID' : '✗ ' + claim.body.error} (keyed by ${claim.body.keyedBy})`);
}
console.log('  ⇒ every extra wallet on a cycled real device is an extra claim.');
console.log('    Cost scales with device-hours, not humans — trust-relay#19\'s gap.');

// ── Act 2: the person tier ─────────────────────────────────────────────────
console.log('\n── Act 2 · attested+person (the denominator change) ──────────');
let lastToken;
for (const name of ['wallet A', 'wallet B']) {
  const s = await attestedSession(call);
  const person = await personSession(call, s, suiKp);
  if (person.status !== 200) {
    console.error(`\n✗ ${name}: person tier refused (${person.status}): ${person.body.error}`);
    if (person.status === 403) {
      console.error('\n  The demo Sui key holds no testnet PoR credential yet. Mint one:');
      console.error(`    node ~/por/attestor/scripts/test-mint.js ${suiAddress}`);
      console.error('  then re-run: npm run demo\n');
    }
    server.close();
    process.exit(1);
  }
  lastToken = person.body.token;
  const claim = await call('/claim', { method: 'POST', token: lastToken });
  console.log(`  ${name} ${short(s.wallet.address.toLowerCase())} + PoR ${short(suiAddress)} (L${person.body.person.level}) → claim ${claim.status === 200 ? '✓ PAID' : '✗ ' + claim.body.error}`);
}
console.log('  ⇒ two wallets, two (stub-)attested devices, ONE human, ONE claim.');
console.log('    The unit of quota is now the person credential.');

console.log('\ncomposed session claim (decoded JWT):');
console.log(JSON.stringify(jwtPayload(lastToken), null, 2));

server.close();
