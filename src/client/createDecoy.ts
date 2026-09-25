import type {
  Account,
  AccountSettings,
  ActivityEntry,
  Address,
  Asset,
  BurnerWallet,
  FundingWallet,
  Holding,
  SyncState,
  ViewKeyGrant,
} from "../domain/types";
import type { ChainSync } from "../chain/chainSync";
import { K_EFF_UNLINKABLE_MIN, MAX_LADDER_TERMS } from "../protocol/parameters";
import { isAddress, sameAddress } from "../rules/address";
import { needsAcknowledgement } from "../rules/grade";
import { isLadderTerm, termsTotal, type LadderTerm } from "../rules/ladder";
import { validateRpcUrl } from "../rules/rpcUrl";
import { relayerFee } from "../rules/withdrawal";
import { DecoyError } from "./errors";
import type {
  AccountListener,
  Backend,
  Decoy,
  DepositRequest,
  FoldRequest,
  SetMeterReading,
  SettingsPatch,
  SharedViewKey,
  ShareViewKeyRequest,
  Unsubscribe,
  WithdrawalAmount,
  WithdrawalQuote,
  WithdrawRequest,
} from "./types";

export interface DecoyOptions {
  backend: Backend;
  /**
   * The live chain height. Without it the account reports the offline sync state, because nothing has read a chain: the
   * client never invents a block number.
   */
  chainSync?: ChainSync;
}

function findFundingWallet(account: Account, address: Address): FundingWallet {
  const wallet = account.fundingWallets.find((candidate) => sameAddress(candidate.address, address));
  if (!wallet) throw new DecoyError("unknownFundingWallet", `No funding wallet ${address} on this account`);
  return wallet;
}

function findAsset(backend: Backend, symbol: string): Asset {
  const asset = backend.assets().find((candidate) => candidate.symbol === symbol);
  if (!asset) throw new DecoyError("unknownAsset", `The backend lists no asset ${symbol}`);
  return asset;
}

function checkLadderTerms(terms: readonly LadderTerm[]): void {
  if (terms.length === 0) throw new DecoyError("noLadderTerms", "A deposit needs at least one ladder term");
  if (terms.length > MAX_LADDER_TERMS) {
    throw new DecoyError(
      "tooManyLadderTerms",
      `A deposit takes at most ${MAX_LADDER_TERMS} ladder terms, got ${terms.length}`,
    );
  }
  const invalid = terms.find((term) => !isLadderTerm(term));
  if (invalid !== undefined) throw new DecoyError("invalidLadderTerm", `${invalid} is not a denomination ladder step`);
}

function findHolding(account: Account, symbol: string): Holding {
  const holding = account.holdings.find((candidate) => candidate.asset.symbol === symbol);
  if (!holding) throw new DecoyError("notHeld", `The account holds no ${symbol}`);
  return holding;
}

function checkPositiveAmount(request: WithdrawalAmount): void {
  if (request.amount <= 0n) {
    throw new DecoyError("invalidAmount", `A ${request.asset} amount must be above zero, got ${request.amount}`);
  }
}

function findUnfoldedBurner(account: Account, address: Address): BurnerWallet {
  const burner = account.burners.find((candidate) => sameAddress(candidate.address, address));
  if (!burner) throw new DecoyError("unknownBurner", `No burner wallet ${address} on this account`);
  if (burner.folded) throw new DecoyError("burnerAlreadyFolded", `Burner wallet ${address} is already folded`);
  return burner;
}

function checkedRpcUrl(text: string): string {
  if (validateRpcUrl(text) !== null) throw new DecoyError("invalidRpcUrl", `${text} is not a valid RPC URL`);
  return text.trim();
}

function checkedAutoLock(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new DecoyError("invalidAutoLock", `Auto-lock must be whole minutes above zero, got ${minutes}`);
  }
  return minutes;
}

function quoteWithdrawal(backend: Backend, request: WithdrawalAmount): WithdrawalQuote {
  const { asset } = findHolding(backend.account(), request.asset);
  checkPositiveAmount(request);
  const relayerFeeBps = backend.relayerFeeBps();
  const fee = relayerFee(request.amount, relayerFeeBps);
  return { holding: { asset, amount: request.amount }, relayerFeeBps, fee, received: request.amount - fee };
}

function setMeter(backend: Backend): SetMeterReading {
  const kEff = backend.kEff();
  return { kEff, unlinkable: kEff >= K_EFF_UNLINKABLE_MIN };
}

async function deposit(backend: Backend, request: DepositRequest): Promise<ActivityEntry> {
  const wallet = findFundingWallet(backend.account(), request.from);
  if (needsAcknowledgement(wallet.grade) && request.acknowledgeGrade !== true) {
    throw new DecoyError(
      "gradeNotAcknowledged",
      `Funding wallet ${wallet.address} has grade ${wallet.grade}; set acknowledgeGrade to deposit from it`,
    );
  }
  const asset = findAsset(backend, request.asset);
  checkLadderTerms(request.terms);
  return backend.deposit({ asset, amount: termsTotal(request.terms, asset) }, wallet.address);
}

async function fold(backend: Backend, request: FoldRequest): Promise<ActivityEntry[]> {
  if (request.burners.length === 0) throw new DecoyError("noBurners", "A fold needs at least one burner wallet");
  const account = backend.account();
  const burners = request.burners.map((address) => findUnfoldedBurner(account, address));
  if (new Set(burners).size !== burners.length) {
    throw new DecoyError("duplicateBurner", "A fold names the same burner wallet more than once");
  }
  return backend.fold(burners.map((burner) => burner.address));
}

async function withdraw(backend: Backend, request: WithdrawRequest): Promise<ActivityEntry> {
  const held = findHolding(backend.account(), request.asset);
  checkPositiveAmount(request);
  if (request.amount > held.amount) {
    throw new DecoyError(
      "insufficientBalance",
      `A withdrawal of ${request.amount} ${request.asset} base units exceeds the ${held.amount} held`,
    );
  }
  const to = request.to.trim();
  if (!isAddress(to)) throw new DecoyError("invalidAddress", `${request.to} is not an address`);
  return backend.withdraw({ asset: held.asset, amount: request.amount }, to);
}

async function shareViewKey(backend: Backend, request: ShareViewKeyRequest): Promise<SharedViewKey> {
  const holder = request.holder.trim();
  if (holder.length === 0) throw new DecoyError("emptyHolder", "A view key needs a holder name");
  return backend.issueViewKey(holder);
}

async function revokeViewKey(backend: Backend, id: string): Promise<ViewKeyGrant> {
  const grant = backend.account().viewKeys.find((candidate) => candidate.id === id);
  if (!grant) throw new DecoyError("unknownViewKey", `No view key ${id} on this account`);
  if (grant.status === "revoked") throw new DecoyError("viewKeyAlreadyRevoked", `View key ${id} is already revoked`);
  return backend.revokeViewKey(id);
}

async function updateSettings(backend: Backend, patch: SettingsPatch): Promise<AccountSettings> {
  const checked: SettingsPatch = { ...patch };
  if (patch.rpcUrl !== undefined) checked.rpcUrl = checkedRpcUrl(patch.rpcUrl);
  if (patch.autoLockMinutes !== undefined) checked.autoLockMinutes = checkedAutoLock(patch.autoLockMinutes);
  return backend.updateSettings(checked);
}

/** Creates the DECOY client on a backend. The client checks every request against the rules before the backend sees it. */
export function createDecoy({ backend, chainSync }: DecoyOptions): Decoy {
  /**
   * The shielded state comes from the backend; the sync state comes from the chain, never from the backend. The merged
   * account keeps its identity until one of its two sources changes, so a subscriber can compare snapshots by reference.
   */
  let merged: { base: Account; sync: SyncState; account: Account } | null = null;
  function account(): Account {
    if (!chainSync) return backend.account();
    const base = backend.account();
    const sync = chainSync.state();
    if (!merged || merged.base !== base || merged.sync !== sync) merged = { base, sync, account: { ...base, sync } };
    return merged.account;
  }

  function subscribe(listener: AccountListener): Unsubscribe {
    const stopBackend = backend.subscribe(() => listener(account()));
    if (!chainSync) return stopBackend;
    const stopChain = chainSync.subscribe(() => listener(account()));
    return () => {
      stopBackend();
      stopChain();
    };
  }

  return {
    account,
    subscribe,
    assets: () => backend.assets(),
    quoteWithdrawal: (request) => quoteWithdrawal(backend, request),
    setMeter: () => setMeter(backend),
    deposit: (request) => deposit(backend, request),
    fold: (request) => fold(backend, request),
    withdraw: (request) => withdraw(backend, request),
    viewKeys: {
      share: (request) => shareViewKey(backend, request),
      revoke: (id) => revokeViewKey(backend, id),
    },
    updateSettings: (patch) => updateSettings(backend, patch),
  };
}
