import { resolveEndpoints, type EndpointOverrides } from "../network/endpoints";
import { DEFAULT_NETWORK, NETWORKS } from "../network/networks";
import type { NetworkName } from "../network/types";
import { createChainReader, type ChainReader } from "./reader";
import { createRpcClient, type RpcSend } from "./rpc";

export interface OpenChainOptions {
  /** Defaults to `DEFAULT_NETWORK`. */
  readonly network?: NetworkName;
  /**
   * The user's node and the Alchemy API key, when the client has them. Pass a function to change them while the client
   * runs: it is read again before every request.
   */
  readonly endpoints?: EndpointOverrides | (() => EndpointOverrides);
  /**
   * Replaces the transport, which by default POSTs with the runtime's `fetch`. Tests pass their own; the desktop app
   * passes `createHttpSend` over a POST that runs in its Rust process. `timeoutMs` applies only to the default.
   */
  readonly send?: RpcSend;
  readonly timeoutMs?: number;
}

/**
 * Opens a read-only view of one network: endpoints in preference order, a client that fails over between them visibly,
 * and a reader on top. Every client calls this rather than wiring the three parts itself.
 */
export function openChain(options: OpenChainOptions = {}): ChainReader {
  const network = NETWORKS[options.network ?? DEFAULT_NETWORK];
  const overrides = options.endpoints;
  const rpc = createRpcClient({
    endpoints: () => resolveEndpoints(network, typeof overrides === "function" ? overrides() : overrides),
    expectedChainId: network.chainId,
    send: options.send,
    timeoutMs: options.timeoutMs,
  });
  return createChainReader(network, rpc);
}
