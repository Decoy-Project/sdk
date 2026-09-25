import { ChainError } from "../chain/errors";
import { validateRpcUrl } from "../rules/rpcUrl";
import type { EndpointId, NetworkConfig, RpcEndpoint } from "./types";

/**
 * Endpoint settings that do not belong to this repository. Neither is ever written to disk here: an Alchemy API key is
 * a secret, and a user's own node is the user's business.
 */
export interface EndpointOverrides {
  /** The user's own node. Preferred over every other endpoint, because pointing the client at your own node is the
   *  strongest privacy choice available and the client must not override it. */
  readonly userRpcUrl?: string;
  /** The user's Alchemy API key, never a URL: the SDK builds the URL from the network's Alchemy host. Preferred over
   *  the public endpoint (owner decision, 20 Sep 2026). */
  readonly alchemyApiKey?: string;
}

/** An API key is one path segment of a URL. Anything else would silently change the URL it is pasted into. */
const API_KEY = /^[A-Za-z0-9_-]+$/;

/** What a masked URL shows in place of the key. */
const MASK = "***";

function endpoint(id: EndpointId, url: string, displayUrl: string = url): RpcEndpoint {
  const problem = validateRpcUrl(url);
  if (problem) throw new ChainError("invalidEndpointUrl", `${id} endpoint URL is ${problem}`);
  return { id, url: url.trim(), displayUrl: displayUrl.trim() };
}

/** Builds the Alchemy endpoint from the network's host and the key. The key appears in `url` and never in `displayUrl`. */
function alchemyEndpoint(network: NetworkConfig, apiKey: string): RpcEndpoint {
  if (!API_KEY.test(apiKey)) {
    throw new ChainError("invalidApiKey", "An Alchemy API key holds letters, digits, hyphens and underscores only");
  }
  const base = `https://${network.alchemyHost}/v2`;
  return endpoint("alchemy", `${base}/${apiKey}`, `${base}/${MASK}`);
}

/**
 * The endpoint list in the order the client tries it: the user's node, then Alchemy, then the network's public endpoint
 * as the backup. An override that is empty or missing is left out; an override that cannot be used throws.
 */
export function resolveEndpoints(network: NetworkConfig, overrides: EndpointOverrides = {}): readonly RpcEndpoint[] {
  const candidates: RpcEndpoint[] = [];
  const user = overrides.userRpcUrl?.trim();
  const apiKey = overrides.alchemyApiKey?.trim();
  if (user) candidates.push(endpoint("user", user));
  if (apiKey) candidates.push(alchemyEndpoint(network, apiKey));
  candidates.push(endpoint("public", network.publicRpcUrl));

  /* One URL, one entry: a user who typed the public endpoint has one endpoint, not two under different names. The
     public entry wins that tie, because it is what the URL is. */
  const publicUrl = candidates[candidates.length - 1].url;
  const kept = new Map<string, RpcEndpoint>();
  for (const candidate of candidates) {
    if (candidate.id !== "public" && candidate.url === publicUrl) continue;
    if (!kept.has(candidate.url)) kept.set(candidate.url, candidate);
  }
  return [...kept.values()];
}
