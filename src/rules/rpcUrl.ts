export const ALLOWED_RPC_PROTOCOLS = ["http:", "https:", "ws:", "wss:"] as const;

/** Protocol names without the trailing colon, for copy. */
export const RPC_PROTOCOL_NAMES = ALLOWED_RPC_PROTOCOLS.map((protocol) => protocol.slice(0, -1));

export type RpcUrlError = "invalidUrl" | "invalidProtocol";

/** `new URL` throws TypeError for unparsable input; that is the validation result. Any other error propagates. */
function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function validateRpcUrl(text: string): RpcUrlError | null {
  const url = parseUrl(text.trim());
  if (!url) return "invalidUrl";
  return (ALLOWED_RPC_PROTOCOLS as readonly string[]).includes(url.protocol) ? null : "invalidProtocol";
}
