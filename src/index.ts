/** Public surface of @decoy/sdk. Clients import from here, never from a file inside the package. */
export type * from "./domain/types";
export * from "./protocol/parameters";
export * from "./rules/address";
export * from "./rules/amount";
export * from "./rules/epoch";
export * from "./rules/foldTotals";
export * from "./rules/grade";
export * from "./rules/ladder";
export * from "./rules/relayerUrl";
export * from "./rules/rpcUrl";
export type * from "./client/types";
export { DecoyError, type DecoyErrorCode } from "./client/errors";
export { createDecoy, type DecoyOptions } from "./client/createDecoy";
export { memoryBackend, type MemoryBackendState } from "./memory/memoryBackend";
export { emptyAccount } from "./state/emptyAccount";
export type * from "./network/types";
export { NETWORKS, ROBINHOOD_MAINNET, ROBINHOOD_TESTNET, ROBINHOOD_LOCAL, DEFAULT_NETWORK } from "./network/networks";
export {
  DEPLOYMENTS,
  POOL_ERROR,
  POOL_EVENT_TOPIC,
  POOL_SELECTOR,
  type Deployment,
  type PoolContracts,
} from "./network/generated/deployments";
export { poolErrorIn, type PoolErrorName } from "./chain/poolErrors";
export { resolveEndpoints, type EndpointOverrides } from "./network/endpoints";
export { ChainError, type ChainErrorCode } from "./chain/errors";
export {
  createRpcClient,
  createHttpSend,
  fetchPost,
  decodeChainId,
  DEFAULT_RPC_TIMEOUT_MS,
  type EndpointListener,
  type EndpointReport,
  type EndpointSource,
  type EndpointState,
  type HttpPost,
  type HttpPostReply,
  type HttpPostRequest,
  type RpcClient,
  type RpcRequest,
  type RpcSend,
} from "./chain/rpc";
export { createChainReader, type ChainReader, type TokenMetadata } from "./chain/reader";
export {
  createPoolReader,
  type AssetCaps,
  type AssetTotals,
  type ClaimedEvent,
  type DepositedEvent,
  type PoolReader,
  type PoolState,
  type QueuedLeaf,
  type TransactedEvent,
} from "./chain/pool";
export { createChainSync, type ChainSync, type ChainSyncOptions, type SyncListener } from "./chain/chainSync";
export { openChain, type OpenChainOptions } from "./chain/openChain";
export { createSigner, quoteFees, type CallRequest, type FeeQuote, type Receipt, type Signer } from "./chain/signer";
export { signTransaction, type Eip1559Transaction, type Hex, type SignedTransaction } from "./chain/transaction";
export { TRANSACTION_POLICY } from "./chain/transactionPolicy";
export { seedFromPhrase } from "./keys/seed";
export { addressOf, keyFromPrivateKey, receiveKey, RECEIVE_PATH, type EvmKey } from "./keys/evm";
export { readFundingEvidence, TRANSFER_TOPIC } from "./chain/fundingHistory";
export { commitmentOf, epochKeysOf, nextCounter, noteSecrets, type NoteSecrets } from "./shield/note";
export {
  buildTransaction,
  transactCalldata,
  type BuiltTransaction,
  type PoolTransaction,
  type TransactionRequest,
} from "./shield/transaction";
export { chooseChurn, createChurner, type Churner, type ChurnerOptions, type ChurnerState } from "./shield/churner";
export { createNoteLock, type NoteLock } from "./shield/noteLock";
export {
  churnNotes,
  withdrawNotes,
  withdrawPayments,
  type PaymentsOutcome,
  type PaymentsRequest,
  type RelayedRequest,
  type TransactOutcome,
  type WithdrawRequest,
  type WithdrawStep,
} from "./shield/withdraw";
export { canClaim, claimNote, type ClaimRequest } from "./shield/claim";
export { chooseNotes, largestPayment, planWithdrawal } from "./shield/choose";
export {
  readPoolHistory,
  viewEpoch,
  type EpochView,
  type NoteSpend,
  type PoolHistory,
  type ViewedNote,
} from "./shield/view";
export { restoreAccount, RESTORE_POLICY, type RestoreRequest, type RestoredAccount } from "./shield/restore";
export { leafIndexIn } from "./shield/queued";
export type { CrsBytes, TransactProof, TransactProver } from "./prove/transactProver";
export { createRelayerClient, RELAY_POLICY, type RelayerClient } from "./relay/client";
export {
  encodeQuote,
  encodeRefusal,
  encodeRelayResult,
  parseQuoteRequest,
  parseRelayRequest,
  RELAY_PATH,
  type QuoteRequest,
  type RelayQuote,
  type RelayRequest,
  type RelayResult,
} from "./relay/protocol";
export { gasReserve, planShield, type ShieldInput, type ShieldPlan } from "./shield/plan";
export {
  depositNote,
  prepareShield,
  type NoteDepositRequest,
  type ShieldParties,
  type ShieldResult,
  type ShieldStep,
} from "./shield/shield";
export { shieldNotes, type NoteStore, type ShieldNotesRequest } from "./shield/shieldNote";
export { shieldSetup, type ShieldableToken, type ShieldSetup } from "./shield/setup";
export {
  createReceiver,
  type ReceiveAddress,
  type ReceiveKind,
  type Receiver,
  type ReceiverOptions,
  type ReceivePhase,
  type StealthPayment,
  type StealthScanStore,
} from "./shield/receiver";
export {
  generateStealthAddress,
  metaAddressOf,
  openAnnouncement,
  STEALTH_SCHEME_ID,
  stealthKeys,
  type StealthAnnouncement,
  type StealthKeys,
} from "./keys/stealth";
export { ANNOUNCEMENT_TOPIC, readAnnouncements, type Announcement, type AnnouncementPage } from "./chain/announcer";
export { activityOf, assetOf, holdingsOf } from "./shield/account";
export {
  accountKeys,
  decodeViewKey,
  encodeViewKey,
  epochKeys,
  epochKeysFrom,
  hexOf,
  viewTierOf,
  VIEW_KEY,
  type AccountKeys,
  type EpochKeys,
  type ViewTierKey,
} from "@decoy/protocol";
export {
  addressWord,
  bytes32Of,
  bytes32Word,
  encodeCall,
  encodeDynamicCall,
  ERC20_SELECTOR,
  uintWord,
  WRAPPED_NATIVE_SELECTOR,
  type AbiArgument,
} from "./chain/abi";
