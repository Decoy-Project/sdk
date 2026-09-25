# Changelog

Each version of `@decoy/sdk`, newest first. `package.json` defines the version itself.

## 0.2.0, 26 Sep 2026

### Added

- Chain access. `openChain` reads one network through an RPC client that tries the user's node, Alchemy and the public
  endpoint in that order. The client refuses an endpoint that reports another chain id. `createChainSync`,
  `createPoolReader` and `createSigner` build on it.
- Keys from the recovery phrase: `seedFromPhrase`, `accountKeys`, `receiveKey` and the ERC-5564 `stealthKeys`.
- The shield layer. It covers deposits with `shieldNotes` and receiving with `createReceiver`, in the amount mode `any`
  or `ladder`. It also covers withdrawals through a relayer with `withdrawPayments`, churns with `createChurner`,
  restores with `restoreAccount`, and claims from a frozen pool with `claimNote`.
- Proving on the device with bb.js, in the entry point `@decoy/sdk/prove`, with the CRS in `assets/crs`.
- The networks `robinhoodMainnet`, with a test pool, `robinhoodTestnet` and `robinhoodLocal`. `DEPLOYMENTS` holds their
  contract addresses. `defaultRelayerUrl` names the relayer of a network.
- README sections for each part of the shield layer.

### Changed

- `LADDER_STEPS` and `MAX_LADDER_TERMS` replace `DENOMINATION_LADDER` and `MAX_LADDER_TERMS_PER_LEG`. They come from
  `@decoy/protocol`, so the circuits, the contracts and the SDK read the same values.
- `createChainSync` reports `syncing` only before the first height and after the chain was offline.
- The memory backend returns an empty `key` from `viewKeys.share`.
- The development tools: tsx 4.23.15, @types/node 26.6.2, eslint 10.11.0 and typescript-eslint 8.70.1.

### Pinned

- `@aztec/bb.js` 5.0.0-nightly.20260522 and `@noir-lang/noir_js` 1.0.0-beta.22, because DECOY built the deployed
  verifiers with them.
- `typescript` 6.0.3, because `typescript-eslint` supports TypeScript versions lower than 6.1 only.

## 0.1.0, 15 Sep 2026

- The first version: the domain types, the rules for input checks, the client and the memory backend.
