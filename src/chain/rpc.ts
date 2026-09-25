import type { Unsubscribe } from "../client/types";
import type { EndpointId, RpcEndpoint } from "../network/types";
import { ChainError } from "./errors";

/** A JSON-RPC request. Params are passed through untouched; each caller owns its own encoding. */
export interface RpcRequest {
  readonly method: string;
  readonly params: readonly unknown[];
}

/** How a request reaches an endpoint. The default sends it over HTTP; tests pass their own. */
export type RpcSend = (endpoint: RpcEndpoint, request: RpcRequest) => Promise<unknown>;

export type EndpointState = "untried" | "serving" | "failed" | "refused";

/**
 * What each endpoint is doing. The client exposes this so a user interface can name the party that answered: a privacy
 * client never hides which endpoint served a query, and never fails over in silence.
 */
export interface EndpointReport {
  readonly endpoint: RpcEndpoint;
  readonly state: EndpointState;
  /** Why the endpoint is not serving. Null while it is untried or serving. */
  readonly problem: string | null;
}

export type EndpointListener = (reports: readonly EndpointReport[]) => void;

export interface RpcClient {
  /** Sends a request to the first endpoint that answers for the expected chain, and decodes its result. */
  call: <Value>(request: RpcRequest, decode: (result: unknown) => Value) => Promise<Value>;
  /**
   * Sends a request to endpoint `id` alone, for a method only that provider serves. Throws when no such endpoint is
   * configured, when it was refused, or when it fails: no other endpoint could answer in its place.
   */
  callOn: <Value>(id: EndpointId, request: RpcRequest, decode: (result: unknown) => Value) => Promise<Value>;
  endpoints: () => readonly EndpointReport[];
  /** The endpoint that answered the last successful request, or null before the first one. */
  servedBy: () => RpcEndpoint | null;
  /** Calls the listener after every change to the reports. Returns a function that removes the listener. */
  subscribe: (listener: EndpointListener) => Unsubscribe;
}

/**
 * The endpoints to try, in order. A function is read again before every request, so a client can change its endpoints
 * while it runs — a user who adds an API key does not restart the app.
 */
export type EndpointSource = readonly RpcEndpoint[] | (() => readonly RpcEndpoint[]);

export interface RpcClientOptions {
  /** Tried in order. The first entry is the preferred endpoint; later entries are backups. */
  readonly endpoints: EndpointSource;
  /** The chainId every endpoint must report. An endpoint that reports another chain is refused for good. */
  readonly expectedChainId: number;
  readonly send?: RpcSend;
  readonly timeoutMs?: number;
}

/** ESTIMATE, 20 Sep 2026: long enough for a loaded public endpoint, short enough to fail over while a user waits. */
export const DEFAULT_RPC_TIMEOUT_MS = 10_000;

const CHAIN_ID_REQUEST: RpcRequest = { method: "eth_chainId", params: [] };

interface JsonRpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
}

/** A node puts a revert's return data in `error.data`, not always in the message; the message then carries it. */
function revertData(data: unknown): string {
  return typeof data === "string" && /^0x[0-9a-fA-F]*$/.test(data) ? ` [data ${data}]` : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One HTTP POST as a transport moves it: a URL and a JSON body out. */
export interface HttpPostRequest {
  readonly url: string;
  readonly body: string;
  readonly timeoutMs: number;
}

/** What came back. Every HTTP status is a reply; only a transport failure — no connection, a timeout — rejects. */
export interface HttpPostReply {
  readonly status: number;
  readonly body: string;
}

/**
 * Moves one HTTP POST. `fetchPost` is the default. The desktop app passes one that runs in its Rust process, because its
 * webview is allowed no network access of its own.
 */
export type HttpPost = (request: HttpPostRequest) => Promise<HttpPostReply>;

/** POSTs with the runtime's own `fetch`. */
export async function fetchPost({ url, body, timeoutMs }: HttpPostRequest): Promise<HttpPostReply> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, body: await response.text() };
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** `JSON.parse` throws SyntaxError for a body that is not JSON; that is a bad response. Any other error propagates. */
function parseBody(text: string, method: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ChainError("badResponse", `${method}: response is not JSON`);
    throw error;
  }
}

/**
 * Sends one JSON-RPC request as an HTTP POST. A transport failure, an HTTP error status and a JSON-RPC error object all
 * throw.
 */
export function createHttpSend(post: HttpPost = fetchPost, timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS): RpcSend {
  return async (endpoint, request) => {
    const reply = await post({
      url: endpoint.url,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: request.method, params: request.params }),
      timeoutMs,
    });
    if (!isSuccess(reply.status)) {
      throw new ChainError("rpcError", `${request.method}: HTTP ${reply.status} from ${endpoint.id}`);
    }
    const body = parseBody(reply.body, request.method);
    if (!isObject(body)) throw new ChainError("badResponse", `${request.method}: response is not an object`);
    const { result, error } = body as JsonRpcResponse;
    if (error) {
      const detail = `${error.message ?? "error"} (${error.code ?? "no code"})${revertData(error.data)}`;
      throw new ChainError("rpcError", `${request.method}: ${detail}`);
    }
    if (result === undefined) throw new ChainError("badResponse", `${request.method}: response carries no result`);
    return result;
  };
}

export function decodeChainId(result: unknown): number {
  if (typeof result !== "string") throw new ChainError("badResponse", "eth_chainId did not return a string");
  const value = Number(BigInt(result));
  if (!Number.isSafeInteger(value)) throw new ChainError("badResponse", `eth_chainId returned ${result}`);
  return value;
}

function problemText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** No problem text carries an API key: wherever the raw URL appears, the masked one replaces it. */
function redact(text: string, endpoint: RpcEndpoint): string {
  return endpoint.url === endpoint.displayUrl ? text : text.split(endpoint.url).join(endpoint.displayUrl);
}

/**
 * A JSON-RPC client over an ordered endpoint list. It tries the preferred endpoint first and falls back to the next one
 * only after the preferred one fails, and it records every failure so the failover is visible rather than silent.
 */
export function createRpcClient(options: RpcClientOptions): RpcClient {
  const send = options.send ?? createHttpSend(fetchPost, options.timeoutMs);
  const states = new Map<EndpointId, EndpointReport>();
  const verified = new Set<EndpointId>();
  const listeners = new Set<EndpointListener>();
  let servedBy: RpcEndpoint | null = null;

  /**
   * The endpoints as they are now, with the state of each. An endpoint whose URL changed starts again as untried and is
   * verified again, because a new URL is a new party.
   */
  function current(): readonly RpcEndpoint[] {
    const endpoints = typeof options.endpoints === "function" ? options.endpoints() : options.endpoints;
    const ids = new Set(endpoints.map((endpoint) => endpoint.id));
    for (const id of [...states.keys()]) if (!ids.has(id)) states.delete(id);
    for (const endpoint of endpoints) {
      if (states.get(endpoint.id)?.endpoint.url === endpoint.url) continue;
      states.set(endpoint.id, { endpoint, state: "untried", problem: null });
      verified.delete(endpoint.id);
    }
    return endpoints;
  }

  function reports(): readonly EndpointReport[] {
    return current().map((endpoint) => states.get(endpoint.id) ?? { endpoint, state: "untried", problem: null });
  }

  function mark(endpoint: RpcEndpoint, state: EndpointState, problem: string | null): void {
    states.set(endpoint.id, { endpoint, state, problem });
    const snapshot = reports();
    for (const listener of listeners) listener(snapshot);
  }

  /** Reads the chainId once per endpoint. A mismatch refuses the endpoint permanently. */
  async function verify(endpoint: RpcEndpoint): Promise<void> {
    if (verified.has(endpoint.id)) return;
    const chainId = decodeChainId(await send(endpoint, CHAIN_ID_REQUEST));
    if (chainId !== options.expectedChainId) {
      const problem = `reports chainId ${chainId}, expected ${options.expectedChainId}`;
      mark(endpoint, "refused", problem);
      throw new ChainError("wrongChain", `Endpoint ${endpoint.id} ${problem}`);
    }
    verified.add(endpoint.id);
  }

  /** One endpoint's answer, or why it gave none, with the endpoint's secret kept out of the reason. */
  async function attempt<Value>(
    endpoint: RpcEndpoint,
    request: RpcRequest,
    decode: (result: unknown) => Value,
  ): Promise<{ ok: true; value: Value } | { ok: false; problem: string }> {
    if (states.get(endpoint.id)?.state === "refused") return { ok: false, problem: states.get(endpoint.id)?.problem ?? "refused" };
    try {
      await verify(endpoint);
      const value = decode(await send(endpoint, request));
      servedBy = endpoint;
      mark(endpoint, "serving", null);
      return { ok: true, value };
    } catch (error) {
      const problem = redact(problemText(error), endpoint);
      if (states.get(endpoint.id)?.state !== "refused") mark(endpoint, "failed", problem);
      return { ok: false, problem };
    }
  }

  async function call<Value>(request: RpcRequest, decode: (result: unknown) => Value): Promise<Value> {
    const problems: string[] = [];
    for (const endpoint of current()) {
      const answer = await attempt(endpoint, request, decode);
      if (answer.ok) return answer.value;
      problems.push(`${endpoint.id}: ${answer.problem}`);
    }
    throw new ChainError("noEndpointAnswered", `${request.method} failed on every endpoint — ${problems.join("; ")}`);
  }

  async function callOn<Value>(id: EndpointId, request: RpcRequest, decode: (result: unknown) => Value): Promise<Value> {
    const endpoint = current().find((candidate) => candidate.id === id);
    if (!endpoint) throw new ChainError("noEndpointAnswered", `${request.method} needs the ${id} endpoint, and none is configured`);
    const answer = await attempt(endpoint, request, decode);
    if (!answer.ok) throw new ChainError("noEndpointAnswered", `${request.method} failed on ${id} — ${answer.problem}`);
    return answer.value;
  }

  return {
    call,
    callOn,
    endpoints: reports,
    servedBy: () => servedBy,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
