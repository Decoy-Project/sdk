import { mnemonicToSeedSync } from "@scure/bip39";

/** The BIP-39 seed of a recovery phrase, with no passphrase. Every key the account holds is derived from it. */
export function seedFromPhrase(words: readonly string[]): Uint8Array {
  return mnemonicToSeedSync(words.join(" "));
}
