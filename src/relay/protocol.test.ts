import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MEMO_BYTES } from "@decoy/protocol";
import {
  encodeQuote,
  encodeRelayRequest,
  encodeRelayResult,
  parseQuote,
  parseQuoteRequest,
  parseRelayRequest,
  parseRelayResult,
  refusalOf,
  type RelayRequest,
} from "./protocol";

const REQUEST: RelayRequest = {
  chainId: 46630,
  pool: "0x3365a26aa23d1239ef3bb096935fdd0fe6770354",
  proof: `0x${"ab".repeat(8000)}`,
  transaction: {
    root: `0x${"01".repeat(32)}`,
    nullifiers: [`0x${"02".repeat(32)}`, `0x${"03".repeat(32)}`],
    commitments: [`0x${"04".repeat(32)}`, `0x${"05".repeat(32)}`],
    exitAsset: "0xd33de4d258d964b19ac83f4c80d81a0689a9d757",
    exitAmount: 60_000_000_000_000_000n,
    recipient: "0x00000000000000000000000000000000000000b2",
    fee: 30_000_000_000_000n,
  },
  memos: `0x${"07".repeat(2 * MEMO_BYTES)}`,
};

describe("the relay protocol", () => {
  test("carries a transaction, a quote and a result through JSON unchanged", () => {
    assert.deepEqual(parseRelayRequest(encodeRelayRequest(REQUEST)), REQUEST);
    const quote = { relayer: REQUEST.transaction.recipient, asset: REQUEST.transaction.exitAsset, fee: REQUEST.transaction.fee };
    assert.deepEqual(parseQuote(encodeQuote(quote)), quote);
    const result = { transaction: REQUEST.transaction.root, block: 123_506_104n };
    assert.deepEqual(parseRelayResult(encodeRelayResult(result)), result);
  });

  test("refuses a field that is not what it says", () => {
    const body = JSON.parse(encodeRelayRequest(REQUEST)) as Record<string, unknown> & { transaction: Record<string, unknown> };
    const broken = (change: Record<string, unknown>) => JSON.stringify({ ...body, ...change });
    const brokenTransaction = (change: Record<string, unknown>) => broken({ transaction: { ...body.transaction, ...change } });
    assert.throws(() => parseRelayRequest(brokenTransaction({ recipient: "0x1234" })), /recipient is not an address/);
    assert.throws(() => parseRelayRequest(brokenTransaction({ nullifiers: ["0x02"] })), /nullifiers is not a list of 2/);
    assert.throws(() => parseRelayRequest(brokenTransaction({ exitAmount: "-1" })), /exitAmount is not a decimal integer/);
    assert.throws(() => parseRelayRequest(brokenTransaction({ fee: 3 })), /fee is not a decimal integer/);
    assert.throws(() => parseRelayRequest(broken({ memos: `0x${"07".repeat(MEMO_BYTES)}` })), /not 2 memos/);
    assert.throws(() => parseRelayRequest(broken({ proof: `0x${"ab".repeat(16_385)}` })), /longer than/);
    assert.throws(() => parseRelayRequest(broken({ chainId: "46630" })), /chainId/);
    assert.throws(() => parseQuoteRequest("[]"), /not a JSON object/);
    assert.throws(() => parseQuoteRequest("{"), /not JSON/);
  });

  test("reads a relayer's reason for saying no, or says it gave none", () => {
    assert.equal(refusalOf(400, JSON.stringify({ error: "The fee is below 30000" })), "The fee is below 30000");
    assert.equal(refusalOf(502, "<html>Bad gateway</html>"), "HTTP 502 with no reason given");
    assert.equal(refusalOf(500, JSON.stringify({ error: "" })), "HTTP 500 with no reason given");
  });
});
