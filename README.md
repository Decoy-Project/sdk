# @decoy/sdk

`@decoy/sdk` is the TypeScript SDK for DECOY. It holds the domain types, the protocol parameters, the rules that
check a request, and the client. The DECOY desktop app and the DECOY CLI read and change the account only through
this package.

## Status on 26 Sep 2026

- The SDK reads Robinhood Chain. `openChain` gives a read-only view of the chain: the height, a native balance, a
  token balance and token metadata. See [Read the chain](#read-the-chain).
- The DECOY pool exists on the testnet. A test pool exists on mainnet, with caps of 0.05 WETH a note and 0.2 WETH in
  all. `apps/protocol` generates their addresses into `src/network/generated/deployments.ts`.
- The shield layer works against that pool:
  - deposits (`shieldNotes`) and receiving, from fresh addresses and ERC-5564 stealth payments (`createReceiver`);
  - withdrawals through a relayer (`withdrawPayments`, `createRelayerClient`), and claims from a frozen pool
    (`claimNote`);
  - churn and epoch revoke (`createChurner`), and restore from the recovery phrase (`restoreAccount`).
  - Proofs are made on the device with bb.js (`@decoy/sdk/prove`).
- `createDecoy` still runs on `memoryBackend` for the account features that have no chain implementation yet.
- The protocol parameters are ESTIMATE values from DECOY's design research, dated 12 Sep 2026.
- The SDK depends on `@decoy/protocol`, which is not published. It builds inside the DECOY workspace, next to that
  package. The SDK itself is not published to npm either.

## Install

To work on the SDK, clone this repository and run this command in its root folder:

```sh
npm install
```

The `engines` field in `package.json` names the Node.js version that the checks need.

The package exports TypeScript source from `src/index.ts`. A project that imports the SDK compiles that source with
its own build tool, for example Vite, esbuild or `tsx`.

## Create a client

To create a client, pass a backend to `createDecoy`:

```ts
import { createDecoy, memoryBackend } from "@decoy/sdk";

const decoy = createDecoy({
  backend: memoryBackend({ account, assets, relayerFeeBps: 10, kEff: 7 }),
});
```

`memoryBackend` takes a `MemoryBackendState`:

| Field | Type | Meaning |
|---|---|---|
| `account` | `Account` | The account that the backend starts from. |
| `assets` | `readonly Asset[]` | The assets that a deposit can use. |
| `relayerFeeBps` | `number` | The relayer fee on withdrawals, in basis points. |
| `kEff` | `number` | The Set Meter reading that `setMeter` reports. |

The example uses invented numbers. For a complete `Account` to start from, see `fixtureAccount` in
`src/client/createDecoy.test.ts`.

## Read the chain

`openChain` opens a read-only view of one network:

```ts
import { openChain } from "@decoy/sdk";

const chain = openChain({ endpoints: { alchemyApiKey: process.env.DECOY_ALCHEMY_KEY } });

const height = await chain.blockNumber();
const assets = await chain.readAssets();
```

The client tries the endpoints in this order, and uses the first one that answers for the expected chain:

| Order | Endpoint | Source |
|---|---|---|
| 1 | `user` | `endpoints.userRpcUrl`, the node that the user set |
| 2 | `alchemy` | `endpoints.alchemyApiKey`, with the URL built from `alchemyHost` in the network config |
| 3 | `public` | `publicRpcUrl` in the network config |

The SDK takes an Alchemy API key, never an Alchemy URL. It builds the URL from the network's host, so a key cannot
send a request to a host that the config does not name.

An API key never comes from this package. The caller reads it from its own configuration and passes the key.

Each endpoint carries two URLs. The `url` field holds the key and goes to the network. The `displayUrl` field masks the
key, and every message a user can see uses it: the endpoint reports, the problem texts and the errors. A key that holds
a character other than a letter, a digit, a hyphen or an underscore throws `invalidApiKey`, because such a key would
change the URL that the SDK builds.

The chain values, the token addresses and the public endpoint have one definition site: `src/network/networks.ts`.

`ChainReader` has these methods:

| Method | Result |
|---|---|
| `chainId` | The chain id that the endpoint reports. |
| `blockNumber` | The height of the last block. |
| `nativeBalance` | The balance of the gas token, in base units. |
| `tokenBalance` | The balance of one ERC-20 token, in base units. |
| `tokenMetadata` | The symbol, the name and the decimals of one token. |
| `readAssets` | Each configured token, read from its contract. |
| `endpoints` | The state of each endpoint, and the problem that stopped it. |
| `servedBy` | The endpoint that answered the last read. |

A read that cannot give a correct answer throws a `ChainError`. `readAssets` throws `assetMismatch` when a contract
reports a different symbol or a different number of decimals than the network config. An endpoint that answers for
another chain gets the state `refused`, and the client does not use it again.

To follow the height, create a `ChainSync` and pass it to `createDecoy`:

```ts
import { createChainSync, createDecoy, memoryBackend, openChain } from "@decoy/sdk";

const chain = openChain();
const chainSync = createChainSync(chain, { pollMs: 1000 });
const decoy = createDecoy({ backend: memoryBackend(state), chainSync });

chainSync.start();
```

`account().sync` then carries the height and the id of the endpoint that served it. Without a `chainSync`, the sync
state is `offline` at block 0, because the client never invents a block number.

### Endpoints that change while the client runs

`endpoints` also takes a function. The client reads it again before every request, so a user who adds an API key or
points the app at another node does not restart it:

```ts
const settings = { alchemyApiKey: null as string | null };
const chain = openChain({ endpoints: () => ({ alchemyApiKey: settings.alchemyApiKey ?? undefined }) });

settings.alchemyApiKey = keyFromTheCredentialStore; // the next request goes to Alchemy
```

An endpoint whose URL changed starts again as `untried`, and the client verifies its chain id again, because a new URL
is a new party.

## Choose a network

`NETWORKS` holds one `NetworkConfig` for each network that the SDK knows. `DEFAULT_NETWORK` is `robinhoodMainnet`.

| Name | Network |
|---|---|
| `robinhoodMainnet` | Robinhood Chain, with a test pool. The pool caps each note and its total at low values. |
| `robinhoodTestnet` | The Robinhood Chain testnet, with its pool. |
| `robinhoodLocal` | A local anvil fork, with a pool that `apps/protocol` deployed on it. |

To open a network other than the default, pass its name to `openChain`:

```ts
import { openChain } from "@decoy/sdk";

const chain = openChain({ network: "robinhoodTestnet" });
```

The shield layer reads these fields of a `NetworkConfig`:

| Field | Meaning |
|---|---|
| `contracts` | The pool, the two verifiers and `deployedBlock`. A network without a pool has no `contracts`. |
| `tokens` | The tokens that the SDK reads. The pool takes the token that has `wrapsNative` and a `ladderUnit`. |
| `shieldGas` | The gas of a wrap, an approve and a deposit. The receiver keeps enough ETH back to pay it. |
| `withdrawGas` | The gas of one pool transaction. A relayer quotes its fee from it. |
| `defaultRelayerUrl` | The relayer that DECOY runs for the network. It is absent while DECOY runs none. |
| `stealthAnnouncer` | The ERC-5564 Announcer. A network without one has no stealth payments. |

The contract addresses come from `DEPLOYMENTS`, which `apps/protocol` generates from its deployment records. Import
them from the SDK. Do not copy an address into a client.

## Derive the account keys

Every key of an account comes from its recovery phrase. The phrase is the only secret that a user keeps.

> **Warning:** The seed and every key that comes from it control the account. Do not log them, and do not send them
> over the network.

```ts
import { accountKeys, metaAddressOf, receiveKey, seedFromPhrase, stealthKeys } from "@decoy/sdk";

const seed = seedFromPhrase(phraseWords);
const account = accountKeys(seed);
const firstReceiveAddress = receiveKey(seed, 0).address;
const stealthMetaAddress = metaAddressOf(stealthKeys(seed));
```

| Export | Result |
|---|---|
| `seedFromPhrase(words)` | The BIP-39 seed of a recovery phrase. |
| `accountKeys(seed)` | The spend key and the view keys of the account, as `AccountKeys`. |
| `receiveKey(seed, index)` | The key of receive address `index` on the BIP-44 path `RECEIVE_PATH`. An Ethereum wallet that imports the phrase shows the same addresses. |
| `stealthKeys(seed)` | The ERC-5564 keys of the account. |
| `metaAddressOf(keys)` | The stealth meta-address that a sender uses to pay the account. |

## Read the pool

`createPoolReader(network, reader)` reads the DECOY pool of one network. On a network without `contracts`, it throws a
`ChainError` with the code `poolNotDeployed`.

```ts
import { createPoolReader, NETWORKS, openChain } from "@decoy/sdk";

const chain = openChain({ network: "robinhoodMainnet" });
const pool = createPoolReader(NETWORKS.robinhoodMainnet, chain);
const { queueLength, absorbedCount, root } = await pool.state();
```

| Method | Result |
|---|---|
| `state()` | The number of queued notes, the number that the tree absorbed, and the current root. |
| `totals(asset)` | The shielded and the pending amounts of one asset. |
| `caps(asset)` | The note cap and the supply cap of one asset. They never change. |
| `room(asset)` | The most that one note, and all new notes together, can hold now. |
| `frozen()` | `true` when the guardian froze the pool. A frozen pool takes no deposit and pays out only by claim. |
| `isSpent(nullifier)` | `true` when a transaction or a claim spent the note of this nullifier. |
| `isKnownRoot(root)` | `true` when the pool still takes a transaction against this root. |
| `leaves(fromBlock)` | Every queued note commitment, in queue order. |
| `deposits(fromBlock)` | Every deposit. |
| `transactions(fromBlock)` | Every pool transaction. |
| `claims(fromBlock)` | Every claim from a frozen pool. |

Each method that reads logs starts at `deployedBlock` when you leave out `fromBlock`.

## Shield ETH into the pool

To move ETH from an address that you hold into the pool, call `shieldNotes`. It wraps the ETH, approves the pool once,
and deposits one note for each amount. The address pays the gas.

```ts
import { createNoteLock, receiveKey, shieldNotes, shieldSetup } from "@decoy/sdk";

const setup = shieldSetup(chain);
const notes = await shieldNotes({
  reader: chain,
  setup,
  store,
  account,
  epoch: 0,
  from: receiveKey(seed, 0),
  amounts: [setup.token.ladderUnit],
  onStep: (step) => console.log(step),
});
```

| Field | Type | Rule |
|---|---|---|
| `reader` | `ChainReader` | The chain that holds the pool. |
| `setup` | `ShieldSetup` | From `shieldSetup(reader)`. It throws on a network that cannot shield. |
| `store` | `NoteStore` | The store that saves the notes. The `NoteStore` table in this section lists its members. |
| `account` | `AccountKeys` | From `accountKeys(seed)`. |
| `epoch` | `number` | The current epoch of the account. The new notes belong to it. |
| `from` | `EvmKey` | The address that holds the ETH and pays the gas. |
| `amounts` | `readonly bigint[]` | From 1 to `MAX_LADDER_TERMS` amounts in base units, each more than zero and not more than `room`. |
| `onStep` | `(step: ShieldStep) => void` | Called with `wrapping`, `approving` and `depositing`. |

A note moves through these statuses:

| Status | Meaning |
|---|---|
| `sending` | Saved before its transaction goes, so a crash loses nothing. |
| `pending` | Queued in the pool. It cannot be spent yet. |
| `settled` | In the tree. It can be spent. |
| `spending` | A transaction that spends it is on its way. |
| `spent` | Spent by a transaction or a claim. |

A note stays `pending` until an absorber moves its batch into the tree. An absorber moves queued notes in batches of
`ABSORB_BATCH`, a constant of `@decoy/protocol`, and completes a short batch with filler notes. The receiver marks a
note `settled` at its first check after that.

The caller owns the storage of notes. A `NoteStore` has three members:

| Member | Contract |
|---|---|
| `notes()` | Returns every note of the account. |
| `put(note)` | Saves `note` in place of the note with the same epoch and counter. Resolves when the save is durable. |
| `drop(note)` | Forgets a note whose transaction was never mined. Resolves when the save is durable. |

> **Warning:** Share one `NoteLock` from `createNoteLock()` among everything that makes or spends notes. Two writers
> without a lock can give two notes the same counter.

## Receive payments

`createReceiver(options)` watches the receive addresses and the stealth payments of an account. It shields what
arrives at them into the pool.

| Option | Type | Meaning |
|---|---|---|
| `reader` | `ChainReader` | The chain that holds the pool. |
| `seed` | `Uint8Array` | The seed of the account. The receiver derives the key of each address from it. |
| `account` | `AccountKeys` | From `accountKeys(seed)`. |
| `epoch` | `() => number` | The current epoch of the account. |
| `mode` | `() => AmountMode` | `"any"` shields all that arrives, less the gas reserve. `"ladder"` shields the largest ladder amount and leaves the rest at the address. |
| `store` | `NoteStore` | The store that saves the notes. |
| `stealthScan` | `StealthScanStore` | Where the scan for stealth payments stands, so a new session continues from there. |
| `issued` | `() => number` | How many receive addresses the account handed out. |
| `lock` | `NoteLock` | The lock that everything that makes or spends notes shares. |
| `pollMs` | `number` | The time between checks, in milliseconds. |

The receiver reads `mode`, `epoch` and `issued` again at every check, so a change applies without a restart.

| Member | Result |
|---|---|
| `start()`, `stop()` | Starts or stops the checks. |
| `check()` | Runs one check now. One check runs at a time. |
| `addresses()` | Each watched address with its balances, its phase and its last problem. |
| `metaAddress()` | The stealth meta-address to share, or `null` on a network without an Announcer. |
| `checked()` | `true` after the first check finished. Before that, the note statuses are as the store saved them. |
| `problem()` | Why the last check could not finish, or `null`. |
| `frozen()` | Whether the pool was frozen at the last check. `null` before the first check. |
| `retry(id)` | Lets a failed address try again at the next check. |
| `subscribe(listener)` | Calls `listener` after every change. Returns a function that removes the listener. |

## Withdraw through a relayer

A relayer sends a pool transaction for the account and takes its fee from the notes. No wallet of the user pays gas
or appears as the sender. The proof binds the recipient, the amounts and the fee, so a relayer can only send the
transaction or refuse it.

To withdraw, do these steps:

1. Get the relayer. `relayerFor(chosen, network)` returns the relayer that the user named, else the default of the
   network, else `null`.
2. Create the relayer client with `createRelayerClient(url, network, fetchPost)`.
3. Get the fee with `relayer.quote(asset)`.
4. Create a prover. See [Prove a transaction on the device](#prove-a-transaction-on-the-device).
5. Call `withdrawPayments`.

```ts
import { createRelayerClient, fetchPost, relayerFor, withdrawPayments } from "@decoy/sdk";

const network = chain.network();
const choice = relayerFor(userRelayerUrl, network);
if (choice === null) throw new Error("Name a relayer first");
const relayer = createRelayerClient(choice.url, network, fetchPost);
const quote = await relayer.quote(setup.token.address);

const outcome = await withdrawPayments({
  reader: chain,
  pool: setup.pool,
  store,
  account,
  epoch: 0,
  quote,
  relayer,
  prover,
  amounts: [setup.token.ladderUnit],
  recipient: "0x000000000000000000000000000000000000dEaD",
  onStep: (payment, step) => console.log(payment, step),
});
```

| Field | Type | Rule |
|---|---|---|
| `reader` | `ChainReader` | The chain that holds the pool. |
| `pool` | `PoolReader` | The pool of the network. |
| `store` | `NoteStore` | The store that saves the notes. |
| `account` | `AccountKeys` | From `accountKeys(seed)`. |
| `epoch` | `number` | The current epoch of the account. The change notes belong to it. |
| `quote` | `RelayQuote` | From `relayer.quote(asset)`. Each payment pays this fee. |
| `relayer` | `RelayerClient` | From `createRelayerClient`. |
| `prover` | `TransactProver` | From `createTransactProver`. |
| `amounts` | `readonly bigint[]` | One payment for each amount, in base units. The settled notes must cover each amount and its fee. |
| `recipient` | `Address` | The address that receives each payment. |
| `onStep` | `(payment: number, step: WithdrawStep) => void` | Called with the index of the payment and `building`, `proving`, `relaying` or `confirming`. |

`withdrawPayments` sends one transaction for each amount. It resolves with `sent`, the payments that went, and
`stopped`, the reason that the rest did not go, or `null`. When the first payment fails, nothing goes and the
promise rejects. What a payment does not spend comes back to the account as a change note.

## Prove a transaction on the device

A pool transaction carries a proof that the device makes with bb.js. The prover is in the entry point
`@decoy/sdk/prove`, so a client that does not prove does not load bb.js.

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTransactProver } from "@decoy/sdk/prove";

const crsFile = (name: string) => readFileSync(fileURLToPath(import.meta.resolve(`@decoy/sdk/assets/crs/${name}`)));
const prover = await createTransactProver({ g1: crsFile("bn254_g1.dat"), g2: crsFile("bn254_g2.dat") });
```

The CRS files ship with the package, in `assets/crs`. `createTransactProver` compares the SHA-256 of both files with
`CRS` and throws when they differ.

> **Warning:** Do not download a CRS at run time. The request tells its host that a withdrawal is about to happen.

Call `prover.destroy()` when the client needs no more proofs. It frees the memory and the worker of the prover.

## Restore an account from its recovery phrase

`restoreAccount` finds every note of an account from the phrase alone. Each epoch's view key reads the memos that the
pool logged, and the logs of the pool show which notes are spent.

```ts
import { restoreAccount } from "@decoy/sdk";

const restored = await restoreAccount({ reader: chain, pool, account });
```

| Result field | Meaning |
|---|---|
| `notes` | Every note that the restore found, in epoch and counter order. |
| `epoch` | The epoch that the account continues in. |
| `mismatched` | Leaves that opened under a key of the account but are not its notes. A holder of a view key made them. |

## Churn notes

A churn spends a note into a new note of the same account through the relayer. It breaks the link between the
deposit of a note and the withdrawal that spends it later. `createChurner(options)` sends churns in the background.

| Option | Type | Meaning |
|---|---|---|
| `reader` | `ChainReader` | The chain that holds the pool. |
| `pool` | `PoolReader` | The pool of the network. |
| `store` | `NoteStore` | The store that saves the notes. |
| `account` | `AccountKeys` | From `accountKeys(seed)`. |
| `epoch` | `() => number` | The current epoch of the account. |
| `scheduled` | `() => boolean` | Whether notes of the current epoch churn on `CHURN_SCHEDULE`. Notes of an older epoch churn in all cases. |
| `relayer` | `() => RelayerClient \| null` | The relayer for churns. With `null`, nothing churns. |
| `prover` | `() => Promise<TransactProver>` | Starts the prover when the first churn needs it. |
| `lock` | `NoteLock` | The lock that everything that makes or spends notes shares. |
| `pollMs` | `number` | The time between checks, in milliseconds. |

A revoke of a view key moves the account to the next epoch. The churner then moves each note of the older epochs into
the new epoch, so the revoked key does not see where they go.

## Claim notes from a frozen pool

When the guardian freezes the pool, the pool takes no transaction. Each note can still leave the pool by claim,
without a proof. `claimNote` sends one transaction that opens the note and pays it to a recipient. The spend key of
the note signs the recipient, so a copy of the transaction cannot pay anyone else.

| Field | Type | Rule |
|---|---|---|
| `reader` | `ChainReader` | The chain that holds the pool. |
| `pool` | `PoolReader` | The pool of the network. `pool.frozen()` must be `true`. |
| `store` | `NoteStore` | The store that saves the notes. |
| `account` | `AccountKeys` | From `accountKeys(seed)`. |
| `note` | `ShieldedNote` | A note for which `canClaim(note)` returns `true`. |
| `recipient` | `Address` | The address that receives the value of the note. |
| `payer` | `EvmKey` | The key that pays the gas. A claim shows the place of the note and its recipient. |

## Reads, listeners and writes

The client has three kinds of members:

| Kind | Members | Result | When a request breaks a rule |
|---|---|---|---|
| Read | `account`, `assets`, `quoteWithdrawal`, `setMeter` | A value, at once | `quoteWithdrawal` throws a `DecoyError`. |
| Listener | `subscribe` | A function that removes the listener | No rule applies. |
| Write | `deposit`, `fold`, `withdraw`, `viewKeys.share`, `viewKeys.revoke`, `updateSettings` | A promise | The promise rejects with a `DecoyError`. |

Reads use the local state of the backend and do not wait for the network. A write changes the account, calls every
listener, and then resolves.

Every member is a plain function. You can pass `decoy.subscribe` and `decoy.account` to React's
`useSyncExternalStore` without `bind`.

## Client reference

### account

`account()` returns the account as the backend holds it now. It returns the same object until the account changes.

### subscribe

`subscribe(listener)` calls `listener` with the new account after every change. It returns a function. Call that
function to stop the calls.

### assets

`assets()` returns the assets that `deposit` accepts, as `readonly Asset[]`.

### deposit

`deposit(request)` records a deposit from a funding wallet on the account. It resolves with the new `ActivityEntry`,
which has the status `pending`.

| Field | Type | Required | Rule |
|---|---|---|---|
| `from` | `Address` | Yes | A funding wallet on the account. Letter case does not matter. |
| `asset` | `string` | Yes | A symbol that `assets()` lists. |
| `terms` | `readonly number[]` | Yes | From 1 to `MAX_LADDER_TERMS` values. Each value is a step of `LADDER_STEPS`. |
| `acknowledgeGrade` | `boolean` | For grades C and D | Set it to `true` when `needsAcknowledgement(grade)` returns `true`. |

The memory backend reads each term as whole units of the asset. The shield layer uses the `ladderUnit` of the token
instead. See [Shield ETH into the pool](#shield-eth-into-the-pool).

```ts
import { LADDER_STEPS } from "@decoy/sdk";

const [first, second] = LADDER_STEPS;
const entry = await decoy.deposit({
  from: "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
  asset: "USDG",
  terms: [first, second],
});
entry.kind; // "deposit"
entry.status; // "pending"
```

Error codes: `unknownFundingWallet`, `gradeNotAcknowledged`, `unknownAsset`, `noLadderTerms`, `tooManyLadderTerms`,
`invalidLadderTerm`.

### fold

`fold(request)` moves the holdings of burner wallets into the account balance. It resolves with one `ActivityEntry`
for each holding that it moved.

| Field | Type | Required | Rule |
|---|---|---|---|
| `burners` | `readonly Address[]` | Yes | One or more burner wallets on the account that are not folded. Each address appears once. |

```ts
const entries = await decoy.fold({ burners: ["0x1111111111111111111111111111111111111111"] });
entries.every((entry) => entry.kind === "fold"); // true
```

Error codes: `noBurners`, `unknownBurner`, `burnerAlreadyFolded`, `duplicateBurner`.

### quoteWithdrawal

`quoteWithdrawal(request)` returns the relayer fee and the amount received for a withdrawal. It does not change the
account.

| Field | Type | Required | Rule |
|---|---|---|---|
| `asset` | `string` | Yes | The symbol of an asset that the account holds. |
| `amount` | `bigint` | Yes | Base units, more than zero. |

The result is a `WithdrawalQuote` with the fields `holding`, `relayerFeeBps`, `fee` and `received`.

```ts
const quote = decoy.quoteWithdrawal({ asset: "USDG", amount: 250_000_000n });
quote.received === quote.holding.amount - quote.fee; // true
```

Error codes, thrown at once: `notHeld`, `invalidAmount`.

### withdraw

`withdraw(request)` withdraws an amount through a relayer to an address. It resolves with the new `ActivityEntry`,
which has the status `pending`.

| Field | Type | Required | Rule |
|---|---|---|---|
| `asset` | `string` | Yes | The symbol of an asset that the account holds. |
| `amount` | `bigint` | Yes | Base units, more than zero, and not more than the amount held. |
| `to` | `Address` | Yes | `0x` and 40 hexadecimal characters. The client removes surrounding spaces. |

Error codes: `notHeld`, `invalidAmount`, `insufficientBalance`, `invalidAddress`.

### setMeter

`setMeter()` returns the Set Meter reading as `{ kEff, unlinkable }`. `unlinkable` is `true` when `kEff` is at least
`K_EFF_UNLINKABLE_MIN`. When `kEff` is less than `K_EFF_UNLINKABLE_MIN`, the claim is un-copyability, not
unlinkability.

### viewKeys.share

`viewKeys.share(request)` issues a view key for the current epoch. It resolves with a `SharedViewKey`: the `grant` on
the account and the `key` string for the holder.

| Field | Type | Required | Rule |
|---|---|---|---|
| `holder` | `string` | Yes | Not empty after the client removes surrounding spaces. |

The memory backend returns an invented key string that carries no key material.

Error code: `emptyHolder`.

### viewKeys.revoke

`viewKeys.revoke(id)` revokes an active view key and moves the account to `nextEpoch(epoch)`. It resolves with the
revoked `ViewKeyGrant`. The revoked key keeps only what it already saw.

Error codes: `unknownViewKey`, `viewKeyAlreadyRevoked`.

### updateSettings

`updateSettings(patch)` changes the account settings and resolves with the new `AccountSettings`. A field that you
leave out keeps its value.

| Field | Type | Required | Rule |
|---|---|---|---|
| `rpcUrl` | `string` | No | An `http`, `https`, `ws` or `wss` URL. The client removes surrounding spaces. |
| `autoLockMinutes` | `number` | No | A whole number, more than zero. |
| `autoChurn` | `boolean` | No | No rule applies. |

Error codes: `invalidRpcUrl`, `invalidAutoLock`.

## Errors

The client refuses a request that breaks a rule with a `DecoyError`. The `code` field names the rule, and the
`message` field names the value that broke it. The client checks a write before the backend sees it, so a refused
write does not change the account.

```ts
import { DecoyError } from "@decoy/sdk";

try {
  await decoy.withdraw({ asset: "USDG", amount: 0n, to: "0x9999999999999999999999999999999999999999" });
} catch (error) {
  if (!(error instanceof DecoyError)) throw error;
  console.log(`${error.code}: ${error.message}`);
}
// invalidAmount: A USDG amount must be above zero, got 0
```

| Code | Member | Rule that failed |
|---|---|---|
| `unknownFundingWallet` | `deposit` | `from` is not a funding wallet on the account. |
| `gradeNotAcknowledged` | `deposit` | The grade needs acknowledgement, and `acknowledgeGrade` is not `true`. |
| `unknownAsset` | `deposit` | `assets()` does not list `asset`. |
| `noLadderTerms` | `deposit` | `terms` is empty. |
| `tooManyLadderTerms` | `deposit` | `terms` has more than `MAX_LADDER_TERMS` values. |
| `invalidLadderTerm` | `deposit` | A term is not a step of `LADDER_STEPS`. |
| `notHeld` | `quoteWithdrawal`, `withdraw` | The account holds none of `asset`. |
| `invalidAmount` | `quoteWithdrawal`, `withdraw` | `amount` is zero or less. |
| `insufficientBalance` | `withdraw` | `amount` is more than the amount held. |
| `invalidAddress` | `withdraw` | `to` is not an address. |
| `noBurners` | `fold` | `burners` is empty. |
| `unknownBurner` | `fold` | An address is not a burner wallet on the account. |
| `burnerAlreadyFolded` | `fold` | The burner wallet has `folded: true`. |
| `duplicateBurner` | `fold` | An address appears more than once. |
| `emptyHolder` | `viewKeys.share` | `holder` is empty. |
| `unknownViewKey` | `viewKeys.revoke` | No view key on the account has this `id`. |
| `viewKeyAlreadyRevoked` | `viewKeys.revoke` | The view key has the status `revoked`. |
| `invalidRpcUrl` | `updateSettings` | `rpcUrl` is not an `http`, `https`, `ws` or `wss` URL. |
| `invalidAutoLock` | `updateSettings` | `autoLockMinutes` is not a whole number more than zero. |

A chain read that cannot give a correct answer throws a `ChainError`. Its `code` field names the condition:

| Code | Condition |
|---|---|
| `wrongChain` | An endpoint answered for a different chain than the network config expects. |
| `noEndpointAnswered` | Every endpoint failed. The message lists what each one did. |
| `rpcError` | An endpoint returned a JSON-RPC error. |
| `badResponse` | A result did not have the shape that the method promises. |
| `assetMismatch` | A token contract disagrees with the network config. |
| `invalidEndpointUrl` | An endpoint URL is not an `http`, `https`, `ws` or `wss` URL. |
| `invalidApiKey` | An API key holds a character that a URL path segment cannot carry. |
| `poolNotDeployed` | The network has no DECOY pool. |
| `unknownDeploymentBlock` | The deployment record of the pool has no block, so the SDK cannot read its logs. |
| `transactionReverted` | The chain mined a transaction, and the transaction reverted. |
| `transactionNotMined` | The chain did not mine a transaction in the time that `TRANSACTION_POLICY` allows. |
| `transactionHashMismatch` | The endpoint returned another hash than the transaction that the client signed. |

## Rules for input checks

The SDK exports the rules that the client uses. A user interface can check input with these rules before it calls a
write.

| Export | Result |
|---|---|
| `isAddress(text)` | `true` when `text`, without surrounding spaces, is `0x` and 40 hexadecimal characters. |
| `sameAddress(a, b)` | `true` when two addresses are equal, ignoring letter case. |
| `parseTokenAmount(text, asset)` | The amount in base units, or `null` when the text is not a valid amount for the asset. |
| `checkAmount(text, asset, available)` | `{ ok: true, amount }`, or `{ ok: false, error }` with `invalid`, `zero` or `tooHigh`. |
| `toInputText(amount, asset)` | The amount as plain decimal text for an input field. |
| `isLadderTerm(value)` | `true` when `value` is a step of `LADDER_STEPS`. |
| `canAddTerm(terms)` | `true` while `terms` has fewer than `MAX_LADDER_TERMS` values. |
| `termsTotal(terms, asset)` | The sum of the terms, in base units of the asset. |
| `needsAcknowledgement(grade)` | `true` for the funding-hygiene grades C and D. |
| `sumBurnerHoldings(burners)` | The holdings of the burner wallets, summed for each asset. |
| `validateRpcUrl(text)` | `null`, or the error `invalidUrl` or `invalidProtocol`. |
| `validateRelayerUrl(text)` | `null`, or the error `invalidUrl` or `notHttps`. A relayer takes `https`, or `http` on this computer. |
| `relayerFor(chosen, network)` | The relayer that the user named, else the default of the network, each with its `source`, or `null`. |
| `nextEpoch(epoch)` | The epoch that the account moves to when you revoke a view key. |

## Protocol parameters

Import the protocol parameters from the SDK. Do not copy them into a client or into documentation.

| Export | Meaning |
|---|---|
| `LADDER_STEPS` | The steps of the ladder, in ladder units of a token. |
| `MAX_LADDER_TERMS` | The most notes that one deposit makes, and the most ladder steps in one choice. |
| `CHURN_SCHEDULE` | The mean hours and the jitter percent of scheduled churns. |
| `K_EFF_UNLINKABLE_MIN` | The lowest `k_eff` at which a withdrawal counts as unlinkable. |
| `HYGIENE_GRADE_THRESHOLDS` | Where the funding-hygiene grades A and B begin. |

`LADDER_STEPS` and `MAX_LADDER_TERMS` come from `@decoy/protocol`, which generates them from
`apps/protocol/constants/protocol.json`. The circuits and the contracts read the same file. The other values are
defined in `src/protocol/parameters.ts`. Every value is an ESTIMATE, and each definition site gives its date.

## Pinned dependencies

Three dependencies stay at a fixed version on purpose:

| Package | Reason for the pin |
|---|---|
| `@aztec/bb.js` | DECOY built the verifiers on the testnet and on mainnet with this version. A newer prover can make proofs that those contracts reject. |
| `@noir-lang/noir_js` | It must be the release of `nargo` that compiled the transact circuit. `TRANSACT_CIRCUIT_NARGO` names that release. |
| `typescript` | `typescript-eslint` supports TypeScript versions lower than 6.1 only. |

To move `bb.js` or `noir_js` to a new version, compile the circuits again, build new verifiers, and deploy a new pool.

## Write a backend

A backend is an object that implements the `Backend` interface. `createDecoy` checks every request before it calls the
backend, so the backend only carries out the request.

| Member | Contract |
|---|---|
| `account()` | Returns the current account. Returns the same object until the account changes. |
| `subscribe(listener)` | Calls `listener` after every change. Returns a function that removes the listener. |
| `assets()` | Returns the assets that a deposit can use. |
| `relayerFeeBps()` | Returns the relayer fee on withdrawals, in basis points. |
| `kEff()` | Returns the current Set Meter reading. |
| `deposit(holding, from)` | Records the deposit and resolves with its activity entry. |
| `withdraw(holding, to)` | Records the withdrawal and resolves with its activity entry. |
| `fold(burners)` | Folds the burner wallets and resolves with one activity entry for each holding. |
| `issueViewKey(holder)` | Issues a view key and resolves with the grant and the key string. |
| `revokeViewKey(id)` | Revokes the view key, moves the account to the next epoch, and resolves with the grant. |
| `updateSettings(patch)` | Applies the patch and resolves with the new settings. |

A write resolves only after `account()` returns the changed account. Listeners run before the write resolves.

`src/memory/memoryBackend.ts` is the reference backend. It changes the account only through the account reducer in
`src/state/accountReducer.ts`.

## Run the checks

To typecheck, lint and test the SDK, run this command in the root folder of the repository:

```sh
npm run check
```

The command runs `tsc` on the source without Node types, and on the tests with Node types. It then runs ESLint and
the tests. The tests use the Node test runner through `tsx`. A run with no failed test reports `# fail 0`.

## Terms

| Term | Meaning | Do not write |
|---|---|---|
| account | The private balance with its holdings, view keys, settings and activity. | wallet |
| funding wallet | A public wallet that deposits into the account. It has a funding-hygiene grade. | source wallet |
| burner wallet | A public wallet whose holdings a fold moves into the account. | throwaway wallet |
| fold | Move the holdings of burner wallets into the account balance. | sweep, consolidate |
| ladder term | One step of `DENOMINATION_LADDER` in a deposit. | chunk |
| epoch | The period that a view key covers. Revoking a view key moves the account to the next epoch. | period, era |
| view key | A read-only key that sees spends and signs nothing. | viewing key, watch key |
| backend | The object that holds the account and carries out the writes of the client. | driver, provider, adapter |
| pool | The DECOY contract that holds the shielded value of every account. | vault, mixer |
| note | One amount of one token in the pool, which only its account can spend. | coin, deposit, UTXO |
| shield | Move value from a public address into the pool as notes. | wrap, hide |
| receive address | A public address of the account, from the recovery phrase, whose arrivals the receiver shields. | deposit address |
| stealth payment | A payment to a one-time address that a sender derived from the stealth meta-address. | private transfer |
| absorber | The service that moves queued notes into the tree of the pool. | batcher, sequencer |
| relayer | The service that sends a pool transaction for the account and takes its fee from the notes. | proxy, forwarder |
| churn | Spend a note into a new note of the same account. | mix, rotate |
| claim | Take a note out of a frozen pool without a proof. | emergency withdrawal |
