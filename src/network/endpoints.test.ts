import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ChainError } from "../chain/errors";
import { resolveEndpoints } from "./endpoints";
import { ROBINHOOD_MAINNET } from "./networks";

/* Invented values. Neither is a real node, and no Alchemy key exists in this repository. */
const USER_NODE = "http://127.0.0.1:8547";
const API_KEY = "placeholder-key-not-real";

describe("resolveEndpoints", () => {
  test("falls back to the public endpoint when nothing is overridden", () => {
    const endpoints = resolveEndpoints(ROBINHOOD_MAINNET);
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.id),
      ["public"],
    );
    assert.equal(endpoints[0].url, ROBINHOOD_MAINNET.publicRpcUrl);
  });

  test("puts Alchemy before the public endpoint", () => {
    const endpoints = resolveEndpoints(ROBINHOOD_MAINNET, { alchemyApiKey: API_KEY });
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.id),
      ["alchemy", "public"],
    );
  });

  test("builds the Alchemy URL from the network's host and the key", () => {
    const [alchemy] = resolveEndpoints(ROBINHOOD_MAINNET, { alchemyApiKey: API_KEY });
    assert.equal(alchemy.url, `https://${ROBINHOOD_MAINNET.alchemyHost}/v2/${API_KEY}`);
  });

  test("keeps the key out of the URL it shows", () => {
    const [alchemy] = resolveEndpoints(ROBINHOOD_MAINNET, { alchemyApiKey: API_KEY });
    assert.equal(alchemy.displayUrl.includes(API_KEY), false);
    assert.equal(alchemy.displayUrl, `https://${ROBINHOOD_MAINNET.alchemyHost}/v2/***`);
  });

  test("refuses a key that would change the URL it is put in", () => {
    for (const alchemyApiKey of ["key/../other", "key?x=1", "key with space", "key#fragment"]) {
      assert.throws(
        () => resolveEndpoints(ROBINHOOD_MAINNET, { alchemyApiKey }),
        (error: unknown) => error instanceof ChainError && error.code === "invalidApiKey",
      );
    }
  });

  test("puts the user's own node before Alchemy", () => {
    const endpoints = resolveEndpoints(ROBINHOOD_MAINNET, { userRpcUrl: USER_NODE, alchemyApiKey: API_KEY });
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.id),
      ["user", "alchemy", "public"],
    );
  });

  test("ignores an override that is blank and trims the one that is not", () => {
    const endpoints = resolveEndpoints(ROBINHOOD_MAINNET, { userRpcUrl: "   ", alchemyApiKey: `  ${API_KEY}  ` });
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.id),
      ["alchemy", "public"],
    );
    assert.equal(endpoints[0].url.endsWith(API_KEY), true);
  });

  test("keeps one entry when the user typed the public endpoint", () => {
    const endpoints = resolveEndpoints(ROBINHOOD_MAINNET, { userRpcUrl: ROBINHOOD_MAINNET.publicRpcUrl });
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.id),
      ["public"],
    );
  });

  test("keeps one entry when the user typed the Alchemy URL as their node", () => {
    const alchemyUrl = `https://${ROBINHOOD_MAINNET.alchemyHost}/v2/${API_KEY}`;
    const endpoints = resolveEndpoints(ROBINHOOD_MAINNET, { userRpcUrl: alchemyUrl, alchemyApiKey: API_KEY });
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.id),
      ["user", "public"],
    );
  });

  test("refuses an override that is not a URL this client will send requests to", () => {
    for (const userRpcUrl of ["not a url", "ftp://node.example"]) {
      assert.throws(
        () => resolveEndpoints(ROBINHOOD_MAINNET, { userRpcUrl }),
        (error: unknown) => error instanceof ChainError && error.code === "invalidEndpointUrl",
      );
    }
  });
});
