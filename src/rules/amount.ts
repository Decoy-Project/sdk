import type { Asset } from "../domain/types";

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

export type AmountError = "invalid" | "zero" | "tooHigh";

export type AmountCheck = { ok: true; amount: bigint } | { ok: false; error: AmountError };

/** Parses user input into base units. Returns null when the text is not a valid amount for this asset. */
export function parseTokenAmount(text: string, asset: Asset): bigint | null {
  const trimmed = text.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > asset.decimals) return null;
  return BigInt(whole) * 10n ** BigInt(asset.decimals) + BigInt(fraction.padEnd(asset.decimals, "0"));
}

export function checkAmount(text: string, asset: Asset, available: bigint): AmountCheck {
  const amount = parseTokenAmount(text, asset);
  if (amount === null) return { ok: false, error: "invalid" };
  if (amount === 0n) return { ok: false, error: "zero" };
  if (amount > available) return { ok: false, error: "tooHigh" };
  return { ok: true, amount };
}

/** Base units as plain decimal text (no grouping), suitable for putting back into the amount input. */
export function toInputText(amount: bigint, asset: Asset): string {
  const base = 10n ** BigInt(asset.decimals);
  const fraction = (amount % base).toString().padStart(asset.decimals, "0").replace(/0+$/, "");
  return fraction ? `${amount / base}.${fraction}` : `${amount / base}`;
}
