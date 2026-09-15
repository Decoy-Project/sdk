# @decoy/sdk

`@decoy/sdk` is the TypeScript SDK for DECOY. It holds the domain types, the protocol parameters, the rules that
check a request, and the client. The DECOY desktop app and the DECOY CLI read and change the account only through
this package.

## Status on 15 Sep 2026

- `memoryBackend` is the only backend. It keeps the account in memory and starts from the state that you pass in.
- No backend reads Robinhood Chain yet, because the DECOY contracts and circuits do not exist.
- The protocol parameters are ESTIMATE values from DECOY's design research, dated 12 Sep 2026.
- The package is not published to npm.

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
| `terms` | `readonly number[]` | Yes | From 1 to `MAX_LADDER_TERMS_PER_LEG` values. Each value is a step of `DENOMINATION_LADDER`. |
| `acknowledgeGrade` | `boolean` | For grades C and D | Set it to `true` when `needsAcknowledgement(grade)` returns `true`. |

The amount is the sum of the terms, in whole units of the asset. DECOY's design research does not state the unit of
a ladder step, so this unit is not verified.

```ts
import { DENOMINATION_LADDER } from "@decoy/sdk";

const [first, second] = DENOMINATION_LADDER;
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
| `tooManyLadderTerms` | `deposit` | `terms` has more than `MAX_LADDER_TERMS_PER_LEG` values. |
| `invalidLadderTerm` | `deposit` | A term is not a step of `DENOMINATION_LADDER`. |
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
| `isLadderTerm(value)` | `true` when `value` is a step of `DENOMINATION_LADDER`. |
| `canAddTerm(terms)` | `true` while `terms` has fewer than `MAX_LADDER_TERMS_PER_LEG` values. |
| `termsTotal(terms, asset)` | The sum of the terms, in base units of the asset. |
| `needsAcknowledgement(grade)` | `true` for the funding-hygiene grades C and D. |
| `sumBurnerHoldings(burners)` | The holdings of the burner wallets, summed for each asset. |
| `validateRpcUrl(text)` | `null`, or the error `invalidUrl` or `invalidProtocol`. |
| `nextEpoch(epoch)` | The epoch that the account moves to when you revoke a view key. |

## Protocol parameters

`src/protocol/parameters.ts` is the only definition site of the protocol parameters in the TypeScript packages. Import
the values from the SDK. Do not copy them into a client or into documentation.

| Export | Meaning |
|---|---|
| `DENOMINATION_LADDER` | The steps that make up a deposit amount. |
| `MAX_LADDER_TERMS_PER_LEG` | The most ladder terms that one deposit or withdrawal leg can use. |
| `CHURN_SCHEDULE` | The mean hours and the jitter percent of automatic churning. |
| `K_EFF_UNLINKABLE_MIN` | The lowest `k_eff` at which a withdrawal counts as unlinkable. |

Every value is an ESTIMATE from 12 Sep 2026. The generated constants source for circuit, contract and client does not
exist yet. When it exists, `parameters.ts` re-exports from it.

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
