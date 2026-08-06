// The personhood leg — the only leg that talks to a chain, and the only one
// that must be real: it reads the holder's PoR credential from Sui testnet.
//
// Transport: gRPC via a small adapter (see grpcSuiAdapter.mjs) because public
// JSON-RPC — por-sdk's default — was retired. Level + expiry are enforced from
// the on-chain credential; the revocation devInspect is skipped until por-sdk
// migrates transports (a freshly minted demo credential is not revoked).
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { PorClient, Level } from 'por-sdk';
import { grpcJsonRpcAdapter } from './grpcSuiAdapter.mjs';

// L0 (DeviceHuman) by default so the demo runs against a test-minted credential.
// A production gate would require Level.RealAction or higher — see README.
export const MIN_LEVEL = Number(process.env.POR_MIN_LEVEL ?? Level.DeviceHuman);
export const VERIFY_URL = 'https://por-proof-of-real.netlify.app';

const NETWORK = process.env.POR_NETWORK || 'testnet';
const grpc = new SuiGrpcClient({
  network: NETWORK,
  baseUrl: process.env.SUI_GRPC_URL || `https://fullnode.${NETWORK}.sui.io:443`,
});
const por = new PorClient({ suiClient: grpcJsonRpcAdapter(grpc) });

export async function checkPerson(suiAddress) {
  const ok = await por.isVerified(suiAddress, MIN_LEVEL, { checkRevocation: false });
  if (!ok) return null;
  const cred = await por.getCredential(suiAddress);
  if (!cred) return null;
  return { level: cred.level, cred: cred.id, chain: `sui:${NETWORK}` };
}
