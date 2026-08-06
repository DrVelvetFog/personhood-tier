// Minimal gRPC → JSON-RPC adapter for por-sdk.
//
// por-sdk@0.8.1 defaults to SuiClient over public JSON-RPC, which Mysten
// retired on fullnode.*.sui.io (testnet 2026-07-06, mainnet 07-20) — so the
// SDK's default transport throws MethodNotFound. PorClient accepts an injected
// `suiClient`, and this adapter serves the one read the credential path needs
// (getOwnedObjects) from the same host's gRPC endpoint, mapped back to the
// JSON-RPC response shape the SDK parses. Same pattern as sui-signal-api's
// facilitator rpc.ts.
//
// devInspect (the isRevoked read) is NOT adapted — call
// isVerified(addr, level, { checkRevocation: false }) until por-sdk itself
// migrates transports.
export function grpcJsonRpcAdapter(grpc) {
  return {
    async getOwnedObjects({ owner, filter, limit = 50 }) {
      const listed = await grpc.listOwnedObjects({
        owner,
        objectType: filter?.StructType,
        pageSize: limit,
        include: { json: true },
      });
      const data = await Promise.all(
        (listed.objects ?? []).map(async (o) => {
          const json = o.json ??
            (await grpc.getObject({ objectId: o.objectId, include: { json: true } })).object?.json;
          return { data: { objectId: o.objectId, content: { dataType: 'moveObject', fields: json } } };
        }),
      );
      return { data };
    },
    async devInspectTransactionBlock() {
      throw new Error(
        'devInspect is not adapted over gRPC — use isVerified(addr, level, { checkRevocation: false })',
      );
    },
  };
}
