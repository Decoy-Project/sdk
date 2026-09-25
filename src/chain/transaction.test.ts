import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { signTransaction, type Eip1559Transaction } from "./transaction";

const PRIVATE_KEY = hexToBytes("01".repeat(32));
const TESTNET_CHAIN_ID = 46_630;
const WETH = "0xd33de4d258d964b19ac83f4c80d81a0689a9d757";
const POOL = "0xd2284dec59444dfc938ab307db029a9ce060dd42";

/**
 * Each raw transaction below was signed by Foundry's `cast mktx` (1.x) with the same key and fields on 24 Sep 2026, so
 * these tests hold this signer to an independent implementation rather than to itself.
 */
const VECTORS: readonly { name: string; tx: Eip1559Transaction; raw: string }[] = [
  {
    name: "a value transfer with calldata and no tip",
    tx: {
      chainId: TESTNET_CHAIN_ID,
      nonce: 0n,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: 20_000_000n,
      gasLimit: 60_000n,
      to: WETH,
      value: 10_000_000_000_000_000n,
      data: "0xd0e30db0",
    },
    raw: "0x02f87382b62680808401312d0082ea6094d33de4d258d964b19ac83f4c80d81a0689a9d757872386f26fc1000084d0e30db0c080a0148eecbddd6cb7496af160f9775394b32da300203201c999b5323741c5b19afea07b20ba9144f034cd00128ef89f286994580add0f0e6bb0b568bbdd765da09ab7",
  },
  {
    name: "an ERC-20 approve with a tip",
    tx: {
      chainId: TESTNET_CHAIN_ID,
      nonce: 1n,
      maxPriorityFeePerGas: 1_000_000n,
      maxFeePerGas: 20_000_000n,
      gasLimit: 60_000n,
      to: WETH,
      value: 0n,
      data: "0x095ea7b3000000000000000000000000d2284dec59444dfc938ab307db029a9ce060dd42000000000000000000000000000000000000000000000000002386f26fc10000",
    },
    raw: "0x02f8b082b62601830f42408401312d0082ea6094d33de4d258d964b19ac83f4c80d81a0689a9d75780b844095ea7b3000000000000000000000000d2284dec59444dfc938ab307db029a9ce060dd42000000000000000000000000000000000000000000000000002386f26fc10000c080a083a65d7b16bf88aa0fe51f3acc673df5eab13bf36c7e5c255488229e8cdfcbb8a013aa3e07b3282c55f21d6ec27342f2384febc5ab3ad7b5bc405054c911a14b65",
  },
  {
    name: "a pool deposit with a two-byte nonce and long calldata",
    tx: {
      chainId: TESTNET_CHAIN_ID,
      nonce: 300n,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: 20_000_000n,
      gasLimit: 1_000_000n,
      to: POOL,
      value: 0n,
      data: "0x26b3293f000000000000000000000000d33de4d258d964b19ac83f4c80d81a0689a9d757000000000000000000000000000000000000000000000000002386f26fc100002a00000000000000000000000000000000000000000000000000000000000001",
    },
    raw: "0x02f8d082b62682012c808401312d00830f424094d2284dec59444dfc938ab307db029a9ce060dd4280b86426b3293f000000000000000000000000d33de4d258d964b19ac83f4c80d81a0689a9d757000000000000000000000000000000000000000000000000002386f26fc100002a00000000000000000000000000000000000000000000000000000000000001c080a02df7391e62b352b060561281e6f7c8419985a973318cb1a84e0aff1489e58a1ea07f4855dc468119f57a3aac5036f8f278e646b943b307d282793f90dc4dec2868",
  },
];

describe("signTransaction", () => {
  for (const vector of VECTORS) {
    test(`matches cast mktx for ${vector.name}`, () => {
      assert.equal(signTransaction(vector.tx, PRIVATE_KEY).raw, vector.raw);
    });
  }

  test("hashes the raw transaction it returns", () => {
    const signed = signTransaction(VECTORS[0].tx, PRIVATE_KEY);
    assert.equal(signed.hash, `0x${bytesToHex(keccak_256(hexToBytes(signed.raw.slice(2))))}`);
  });
});
