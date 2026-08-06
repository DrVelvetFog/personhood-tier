// Mint a testnet L0 PoR credential over gRPC. PoR-operator only: needs the
// attestor checkout's .env (ATTESTOR_SECRET_KEY) and deployment.<network>.json.
//
//   node demo/mint.mjs <recipient-sui-address> [path-to-attestor-.env]
//
// The key is read from the attestor's .env and never printed.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const recipient = process.argv[2];
if (!recipient) throw new Error('usage: node demo/mint.mjs <recipient> [attestor-env-path]');
const envPath = process.argv[3] || `${homedir()}/por/attestor/.env`;
const attestorDir = envPath.replace(/\/\.env$/, '');

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (!env.ATTESTOR_SECRET_KEY) throw new Error('ATTESTOR_SECRET_KEY not found in env file');
const network = env.SUI_NETWORK || 'testnet';
const dep = JSON.parse(readFileSync(`${attestorDir}/deployment.${network}.json`, 'utf8'));

const client = new SuiGrpcClient({ network, baseUrl: `https://fullnode.${network}.sui.io:443` });
const kp = Ed25519Keypair.fromSecretKey(env.ATTESTOR_SECRET_KEY.trim());
const sender = kp.getPublicKey().toSuiAddress();

const ttlDays = Number(env.CREDENTIAL_TTL_DAYS || 30);
const tx = new Transaction();
tx.setSender(sender);
tx.setGasBudget(50_000_000n);
tx.moveCall({
  target: `${dep.packageId}::registry::mint`,
  arguments: [
    tx.object(dep.attestorCapId),
    tx.object(dep.registryId),
    tx.pure.address(recipient),
    tx.pure.u8(0),
    tx.pure.vector('u8', Array.from(randomBytes(32))),
    tx.pure.u64(Date.now() + ttlDays * 86_400_000),
    tx.object('0x6'),
  ],
});

console.log(`minting L0 -> ${recipient} (attestor ${sender.slice(0, 10)}…, ${network}, gRPC)`);
const res = await client.signAndExecuteTransaction({
  signer: kp,
  transaction: tx,
  include: { effects: true },
});
// Unwrap the $kind-discriminated result (same shape the facilitator's rpc.ts
// txOf() handles); status lives on the tx in either place depending on version.
const r = res.transaction ?? res;
const t = r?.$kind === 'Transaction' ? r.Transaction
  : r?.$kind === 'FailedTransaction' ? r.FailedTransaction : r;
const ok = t?.status?.success === true || t?.effects?.status?.success === true;
if (!ok) throw new Error(`mint failed: ${JSON.stringify(t?.status ?? t?.effects?.status ?? res)}`);
console.log('digest:', t.digest);
console.log('✓ minted — verify the credential with: npm run demo');
