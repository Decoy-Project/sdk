import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NETWORKS } from "../network/networks";
import type { NetworkConfig } from "../network/types";
import { relayerBase, relayerFor, validateRelayerUrl } from "./relayerUrl";

describe("validateRelayerUrl", () => {
  test("takes HTTPS anywhere and plain HTTP on this machine only", () => {
    assert.equal(validateRelayerUrl("https://relay.example.org"), null);
    assert.equal(validateRelayerUrl("http://127.0.0.1:8547"), null);
    assert.equal(validateRelayerUrl("http://localhost:8547/"), null);
    assert.equal(validateRelayerUrl("http://relay.example.org"), "notHttps");
    assert.equal(validateRelayerUrl("ws://127.0.0.1:8547"), "notHttps");
  });

  test("refuses what is not a URL, or carries a query", () => {
    assert.equal(validateRelayerUrl("relay.example.org"), "invalidUrl");
    assert.equal(validateRelayerUrl("https://relay.example.org/?key=1"), "invalidUrl");
  });
});

describe("relayerBase", () => {
  test("drops a trailing slash, so paths join cleanly", () => {
    assert.equal(relayerBase(" https://relay.example.org/v1/ "), "https://relay.example.org/v1");
  });

  test("throws on a URL it would refuse", () => {
    assert.throws(() => relayerBase("http://relay.example.org"), /notHttps/);
  });
});

describe("relayerFor", () => {
  const withDefault: NetworkConfig = { ...NETWORKS.robinhoodTestnet, defaultRelayerUrl: "https://relay.example.org" };
  const withoutDefault: NetworkConfig = { ...NETWORKS.robinhoodTestnet, defaultRelayerUrl: undefined };

  test("takes the relayer the user named over the network's default", () => {
    assert.deepEqual(relayerFor("http://127.0.0.1:8547", withDefault), { url: "http://127.0.0.1:8547", source: "chosen" });
  });

  test("falls back to the network's default while the user names none", () => {
    assert.deepEqual(relayerFor(null, withDefault), { url: "https://relay.example.org", source: "default" });
  });

  test("is none where the user named none and the network has no default", () => {
    assert.equal(relayerFor(null, withoutDefault), null);
  });

  test("every network's default is a URL the client accepts", () => {
    for (const network of Object.values(NETWORKS)) {
      if (network.defaultRelayerUrl !== undefined) assert.equal(validateRelayerUrl(network.defaultRelayerUrl), null, network.name);
    }
  });
});
