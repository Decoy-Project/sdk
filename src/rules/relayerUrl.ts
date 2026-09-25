import type { NetworkConfig } from "../network/types";

export type RelayerUrlError = "invalidUrl" | "notHttps";

/** Hosts that name this machine. A relayer here may speak plain HTTP, because nothing on the network sees the request. */
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

/** `new URL` throws TypeError for unparsable input; that is the validation result. Any other error propagates. */
function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

/**
 * A relayer is reached over HTTPS, or over HTTP on this machine. Anything else would show a network observer which
 * withdrawal this device asked for, before the chain shows anyone.
 */
export function validateRelayerUrl(text: string): RelayerUrlError | null {
  const url = parseUrl(text.trim());
  if (!url || url.search !== "" || url.hash !== "") return "invalidUrl";
  if (url.protocol === "https:") return null;
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname) ? null : "notHttps";
}

/** The URL requests are made under: validated, without a trailing slash. */
export function relayerBase(text: string): string {
  const problem = validateRelayerUrl(text);
  if (problem) throw new Error(`${text} is not a relayer URL: ${problem}`);
  return text.trim().replace(/\/+$/, "");
}

/** Where a relayer URL comes from: the user named it, or it is the network's default. */
export type RelayerSource = "chosen" | "default";

export interface RelayerChoice {
  readonly url: string;
  readonly source: RelayerSource;
}

/** The relayer withdrawals go through: the one the user named, else the network's default, else none. */
export function relayerFor(chosen: string | null, network: NetworkConfig): RelayerChoice | null {
  if (chosen !== null) return { url: chosen, source: "chosen" };
  if (network.defaultRelayerUrl !== undefined) return { url: network.defaultRelayerUrl, source: "default" };
  return null;
}
