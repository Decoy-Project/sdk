import { createPoolReader, type PoolReader } from "../chain/pool";
import type { ChainReader } from "../chain/reader";
import type { Address } from "../domain/types";
import type { ShieldGas, TokenConfig } from "../network/types";

/** A token the ladder can cut: it has a ladder unit. */
export type ShieldableToken = TokenConfig & { readonly ladderUnit: bigint };

/** What shielding the native token needs from a network: its pool, its wrapped native token and the measured gas. */
export interface ShieldSetup {
  readonly pool: PoolReader;
  readonly token: ShieldableToken;
  readonly gas: ShieldGas;
  /** The ERC-5564 Announcer, or null where there is none. */
  readonly announcer: Address | null;
}

/** Throws on a network that cannot shield: one without a pool, a wrapped native token with a ladder unit, or measured gas. */
export function shieldSetup(reader: ChainReader): ShieldSetup {
  const network = reader.network();
  const token = network.tokens.find((candidate) => candidate.wrapsNative && candidate.ladderUnit !== undefined);
  if (!token?.ladderUnit) throw new Error(`${network.label} lists no wrapped native token with a ladder unit`);
  if (!network.shieldGas) throw new Error(`${network.label} has no measured shield gas`);
  return {
    pool: createPoolReader(network, reader),
    token: { ...token, ladderUnit: token.ladderUnit },
    gas: network.shieldGas,
    announcer: network.stealthAnnouncer ?? null,
  };
}
