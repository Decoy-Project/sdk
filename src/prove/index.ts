/**
 * The prover, apart from the rest of the SDK: it loads bb.js and noir_js, which are large, so a client imports this only
 * when it proves.
 */
export { createTransactProver, type CrsBytes, type TransactProof, type TransactProver } from "./transactProver";
export { CRS } from "./generated/crs";
