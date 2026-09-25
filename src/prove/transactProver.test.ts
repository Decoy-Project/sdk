import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTransactProver } from "./transactProver";

const ASSETS = fileURLToPath(new URL("../../assets/crs/", import.meta.url));
const crs = { g1: new Uint8Array(readFileSync(`${ASSETS}bn254_g1.dat`)), g2: new Uint8Array(readFileSync(`${ASSETS}bn254_g2.dat`)) };

/* Proving itself is tested where transactions are built (shield/transaction.test.ts): a proof here would need the same
   tree, keys and notes. This file holds the prover to the CRS it was built for. */
describe("createTransactProver", () => {
  test("starts from the shipped CRS slice", async () => {
    const prover = await createTransactProver(crs);
    await prover.destroy();
  });

  test("refuses a CRS it was not cut from", async () => {
    const tampered = { g1: crs.g1.slice(), g2: crs.g2 };
    tampered.g1[0] ^= 1;
    await assert.rejects(createTransactProver(tampered), /not the slice/);
  });
});
