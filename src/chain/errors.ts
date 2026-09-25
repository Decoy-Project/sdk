/** The condition a chain read hit. Every code names something the caller can act on or show. */
export type ChainErrorCode =
  /** An endpoint answered for a different chain than the network config expects. It is never used again. */
  | "wrongChain"
  /** Every configured endpoint failed. The message lists what each one did. */
  | "noEndpointAnswered"
  /** An endpoint returned a JSON-RPC error object. */
  | "rpcError"
  /** A result did not have the shape the method promises. */
  | "badResponse"
  /** On-chain token metadata disagrees with the network config. */
  | "assetMismatch"
  /** An endpoint URL is not a URL this client will send requests to. */
  | "invalidEndpointUrl"
  /** An API key holds characters that a URL path segment cannot carry. */
  | "invalidApiKey"
  /** The network has no DECOY pool. Nothing shielded exists to read. */
  | "poolNotDeployed"
  /** The network config does not record the block its pool was deployed in, so the pool's logs have no start. */
  | "unknownDeploymentBlock"
  /** A transaction the client sent was mined and reverted. */
  | "transactionReverted"
  /** A transaction the client sent was not mined within the wait the policy allows. */
  | "transactionNotMined"
  /** An endpoint answered `eth_sendRawTransaction` with a hash other than the one the client signed. */
  | "transactionHashMismatch";

/**
 * A chain read that could not produce a correct answer. It is thrown, never swallowed: in a shielded client a balance
 * that is quietly wrong is worse than no balance at all.
 */
export class ChainError extends Error {
  readonly code: ChainErrorCode;

  constructor(code: ChainErrorCode, message: string) {
    super(message);
    this.name = "ChainError";
    this.code = code;
  }
}
