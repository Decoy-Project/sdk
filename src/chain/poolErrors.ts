import { POOL_ERROR } from "../network/generated/deployments";

export type PoolErrorName = keyof typeof POOL_ERROR;

const NAMES = Object.keys(POOL_ERROR) as PoolErrorName[];

/**
 * The pool error a failed call reverted with, found by its selector in the error's text: an endpoint reports a revert's
 * return data in its message or in `error.data`, which the RPC client keeps in the message. Null when none is there.
 */
export function poolErrorIn(text: string): PoolErrorName | null {
  const lower = text.toLowerCase();
  return NAMES.find((name) => new RegExp(`${POOL_ERROR[name]}(?![0-9a-f])`).test(lower)) ?? null;
}
