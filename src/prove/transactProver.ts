import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { transactCircuitInputs, type TransactWitness } from "@decoy/protocol";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Noir, type InputMap } from "@noir-lang/noir_js";
import type { Hex } from "../chain/transaction";
import { TRANSACT_CIRCUIT } from "../protocol/generated/transactCircuit";
import { CRS } from "./generated/crs";

/** The CRS slice a client ships (apps/sdk/assets/crs), as bytes. `generated/crs.ts` records what they hash to. */
export interface CrsBytes {
  readonly g1: Uint8Array;
  readonly g2: Uint8Array;
}

export interface TransactProof {
  readonly proof: Hex;
  /** The public inputs in the circuit's order, as the verifier takes them. */
  readonly publicInputs: readonly Hex[];
}

export interface TransactProver {
  prove: (witness: TransactWitness) => Promise<TransactProof>;
  /** Frees the prover's memory and its worker. */
  destroy: () => Promise<void>;
}

function hex(value: string): Hex {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`bb.js returned a public input that is not hex: ${value}`);
  return value as Hex;
}

/** A CRS other than the slice this build was cut with gives proofs no verifier accepts, so it is refused up front. */
function checkCrs(crs: CrsBytes): void {
  if (bytesToHex(sha256(crs.g1)) !== CRS.g1Sha256) throw new Error("The CRS G1 points are not the slice this build was cut with");
  if (bytesToHex(sha256(crs.g2)) !== CRS.g2Sha256) throw new Error("The CRS G2 point is not the one this build was cut with");
}

/**
 * A prover for transactions. bb.js is started without its own CRS download, which would tell Aztec's CRS host who is
 * about to transact, and when; it is given the shipped slice instead.
 */
export async function createTransactProver(crs: CrsBytes): Promise<TransactProver> {
  checkCrs(crs);
  const api = await Barretenberg.new({ skipSrsInit: true, threads: 1 });
  await api.srsInitSrs({ pointsBuf: crs.g1, numPoints: CRS.points, g2Point: crs.g2 });
  const backend = new UltraHonkBackend(TRANSACT_CIRCUIT.bytecode, api);
  const noir = new Noir(TRANSACT_CIRCUIT);

  async function prove(witness: TransactWitness): Promise<TransactProof> {
    const { witness: solved } = await noir.execute(transactCircuitInputs(witness) as InputMap);
    const { proof, publicInputs } = await backend.generateProof(solved, { verifierTarget: "evm" });
    return { proof: `0x${bytesToHex(proof)}`, publicInputs: publicInputs.map(hex) };
  }

  return { prove, destroy: () => api.destroy() };
}
