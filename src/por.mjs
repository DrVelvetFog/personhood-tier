// The personhood leg — the only leg that talks to a chain, and the only one
// that must be real: it reads the holder's PoR credential from Sui testnet.
// por-sdk >= 0.9 speaks gRPC natively (public JSON-RPC was retired mid-2026),
// so the default client works; isVerified enforces level + expiry + revocation.
import { PorClient, Level } from 'por-sdk';

// L0 (DeviceHuman) by default so the demo runs against a test-minted credential.
// A production gate would require Level.RealAction or higher — see README.
export const MIN_LEVEL = Number(process.env.POR_MIN_LEVEL ?? Level.DeviceHuman);
export const VERIFY_URL = 'https://por-proof-of-real.netlify.app';

const por = new PorClient(); // testnet deployment by default

export async function checkPerson(suiAddress) {
  const ok = await por.isVerified(suiAddress, MIN_LEVEL);
  if (!ok) return null;
  const cred = await por.getCredential(suiAddress);
  if (!cred) return null;
  return { level: cred.level, cred: cred.id, chain: 'sui:testnet' };
}
