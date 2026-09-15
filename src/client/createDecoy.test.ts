import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Account, Address, Asset } from "../domain/types";
import { memoryBackend } from "../memory/memoryBackend";
import { DENOMINATION_LADDER, K_EFF_UNLINKABLE_MIN, MAX_LADDER_TERMS_PER_LEG } from "../protocol/parameters";
import { nextEpoch } from "../rules/epoch";
import { createDecoy } from "./createDecoy";
import { DecoyError, type DecoyErrorCode } from "./errors";
import type { Decoy } from "./types";

/* Invented fixture values. None is a real address, fee or balance. */
const USDG: Asset = { symbol: "USDG", name: "Global Dollar", kind: "stablecoin", decimals: 6 };
const WETH: Asset = { symbol: "WETH", name: "Wrapped Ether", kind: "crypto", decimals: 18 };
const USDG_UNIT = 10n ** BigInt(USDG.decimals);
const WETH_TENTH = 10n ** BigInt(WETH.decimals - 1);
const RELAYER_FEE_BPS = 10;
const EPOCH = 3;
const FIXTURE_TIME = new Date("2026-09-01T00:00:00Z");

const [SMALL_STEP, SECOND_STEP] = DENOMINATION_LADDER;
const NOT_A_STEP = Math.max(...DENOMINATION_LADDER) + 1;

function fixtureAddress(byte: string): Address {
  return `0x${byte.repeat(20)}`;
}

const CLEAN_WALLET = fixtureAddress("a1");
const CLEAN_WALLET_UPPERCASE = fixtureAddress("A1");
const TRACEABLE_WALLET = fixtureAddress("c3");
const OPEN_BURNER = fixtureAddress("11");
const FOLDED_BURNER = fixtureAddress("12");
const DESTINATION = fixtureAddress("99");

function fixtureAccount(): Account {
  return {
    epoch: EPOCH,
    holdings: [{ asset: USDG, amount: 500n * USDG_UNIT }],
    fundingWallets: [
      { address: CLEAN_WALLET, label: "Clean", inboundEdges: 120, ageDays: 900, singleSourceFunding: false, grade: "A" },
      { address: TRACEABLE_WALLET, label: "Traceable", inboundEdges: 1, ageDays: 2, singleSourceFunding: true, grade: "D" },
    ],
    burners: [
      {
        address: OPEN_BURNER,
        label: "Open",
        holdings: [
          { asset: USDG, amount: 40n * USDG_UNIT },
          { asset: WETH, amount: WETH_TENTH },
        ],
        lastActiveAt: FIXTURE_TIME,
        folded: false,
      },
      {
        address: FOLDED_BURNER,
        label: "Folded",
        holdings: [{ asset: USDG, amount: 5n * USDG_UNIT }],
        lastActiveAt: FIXTURE_TIME,
        folded: true,
      },
    ],
    viewKeys: [
      {
        id: "vk-active",
        holder: "Second device",
        tier: "viewAll",
        epoch: EPOCH,
        issuedAt: FIXTURE_TIME,
        status: "active",
        revokedAt: null,
      },
      {
        id: "vk-revoked",
        holder: "Old laptop",
        tier: "viewAll",
        epoch: EPOCH - 1,
        issuedAt: FIXTURE_TIME,
        status: "revoked",
        revokedAt: FIXTURE_TIME,
      },
    ],
    activity: [],
    sync: { status: "synced", block: 1n },
    escapeHatch: "normal",
    settings: { rpcUrl: "http://127.0.0.1:8547", autoLockMinutes: 10, autoChurn: true },
  };
}

function client(kEff: number = K_EFF_UNLINKABLE_MIN): Decoy {
  return createDecoy({
    backend: memoryBackend({ account: fixtureAccount(), assets: [USDG, WETH], relayerFeeBps: RELAYER_FEE_BPS, kEff }),
  });
}

function isDecoyError(code: DecoyErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof DecoyError && error.code === code;
}

describe("deposit", () => {
  test("records a pending deposit of the ladder terms' sum", async () => {
    const decoy = client();
    const entry = await decoy.deposit({ from: CLEAN_WALLET, asset: "USDG", terms: [SMALL_STEP, SECOND_STEP] });
    assert.equal(entry.kind, "deposit");
    assert.equal(entry.status, "pending");
    assert.equal(entry.counterparty, CLEAN_WALLET);
    assert.deepEqual(entry.holding, { asset: USDG, amount: BigInt(SMALL_STEP + SECOND_STEP) * USDG_UNIT });
    assert.equal(decoy.account().activity[0], entry);
  });

  test("finds the funding wallet whatever the address case", async () => {
    const entry = await client().deposit({ from: CLEAN_WALLET_UPPERCASE, asset: "USDG", terms: [SMALL_STEP] });
    assert.equal(entry.counterparty, CLEAN_WALLET);
  });

  test("needs acknowledgement to deposit from a traceable wallet", async () => {
    const decoy = client();
    const request = { from: TRACEABLE_WALLET, asset: "USDG", terms: [SMALL_STEP] };
    await assert.rejects(decoy.deposit(request), isDecoyError("gradeNotAcknowledged"));
    const entry = await decoy.deposit({ ...request, acknowledgeGrade: true });
    assert.equal(entry.counterparty, TRACEABLE_WALLET);
  });

  test("refuses an unknown wallet, an unknown asset and invalid ladder terms", async () => {
    const decoy = client();
    const tooMany = Array.from({ length: MAX_LADDER_TERMS_PER_LEG + 1 }, () => SMALL_STEP);
    const valid = { from: CLEAN_WALLET, asset: "USDG", terms: [SMALL_STEP] };
    await assert.rejects(decoy.deposit({ ...valid, from: DESTINATION }), isDecoyError("unknownFundingWallet"));
    await assert.rejects(decoy.deposit({ ...valid, asset: "XYZ" }), isDecoyError("unknownAsset"));
    await assert.rejects(decoy.deposit({ ...valid, terms: [] }), isDecoyError("noLadderTerms"));
    await assert.rejects(decoy.deposit({ ...valid, terms: tooMany }), isDecoyError("tooManyLadderTerms"));
    await assert.rejects(decoy.deposit({ ...valid, terms: [NOT_A_STEP] }), isDecoyError("invalidLadderTerm"));
    assert.equal(decoy.account().activity.length, 0);
  });
});

describe("fold", () => {
  test("moves an open burner's holdings into the balance, one entry per holding", async () => {
    const decoy = client();
    const entries = await decoy.fold({ burners: [OPEN_BURNER] });
    assert.equal(entries.length, 2);
    assert.ok(entries.every((entry) => entry.kind === "fold" && entry.counterparty === OPEN_BURNER));
    const account = decoy.account();
    assert.equal(account.burners.find((burner) => burner.address === OPEN_BURNER)?.folded, true);
    assert.deepEqual(account.holdings, [
      { asset: USDG, amount: 540n * USDG_UNIT },
      { asset: WETH, amount: WETH_TENTH },
    ]);
  });

  test("refuses an empty, unknown, folded or repeated selection", async () => {
    const decoy = client();
    await assert.rejects(decoy.fold({ burners: [] }), isDecoyError("noBurners"));
    await assert.rejects(decoy.fold({ burners: [DESTINATION] }), isDecoyError("unknownBurner"));
    await assert.rejects(decoy.fold({ burners: [FOLDED_BURNER] }), isDecoyError("burnerAlreadyFolded"));
    await assert.rejects(decoy.fold({ burners: [OPEN_BURNER, OPEN_BURNER] }), isDecoyError("duplicateBurner"));
  });
});

describe("withdraw", () => {
  test("quotes the relayer fee and the amount received", () => {
    const quote = client().quoteWithdrawal({ asset: "USDG", amount: 250n * USDG_UNIT });
    const fee = USDG_UNIT / 4n;
    assert.equal(quote.relayerFeeBps, RELAYER_FEE_BPS);
    assert.equal(quote.fee, fee);
    assert.equal(quote.received, 250n * USDG_UNIT - fee);
  });

  test("subtracts the amount and records the destination", async () => {
    const decoy = client();
    const entry = await decoy.withdraw({ asset: "USDG", amount: 250n * USDG_UNIT, to: DESTINATION });
    assert.equal(entry.kind, "withdraw");
    assert.equal(entry.counterparty, DESTINATION);
    assert.deepEqual(decoy.account().holdings, [{ asset: USDG, amount: 250n * USDG_UNIT }]);
  });

  test("refuses an asset not held, a zero amount, too much and a bad address", async () => {
    const decoy = client();
    assert.throws(() => decoy.quoteWithdrawal({ asset: "WETH", amount: 1n }), isDecoyError("notHeld"));
    await assert.rejects(decoy.withdraw({ asset: "WETH", amount: 1n, to: DESTINATION }), isDecoyError("notHeld"));
    await assert.rejects(decoy.withdraw({ asset: "USDG", amount: 0n, to: DESTINATION }), isDecoyError("invalidAmount"));
    await assert.rejects(
      decoy.withdraw({ asset: "USDG", amount: 501n * USDG_UNIT, to: DESTINATION }),
      isDecoyError("insufficientBalance"),
    );
    await assert.rejects(decoy.withdraw({ asset: "USDG", amount: USDG_UNIT, to: "0x1234" }), isDecoyError("invalidAddress"));
  });
});

describe("setMeter", () => {
  test("reads k_eff as unlinkable from K_EFF_UNLINKABLE_MIN up", () => {
    assert.deepEqual(client(K_EFF_UNLINKABLE_MIN).setMeter(), { kEff: K_EFF_UNLINKABLE_MIN, unlinkable: true });
    assert.deepEqual(client(K_EFF_UNLINKABLE_MIN - 1).setMeter(), { kEff: K_EFF_UNLINKABLE_MIN - 1, unlinkable: false });
  });
});

describe("view keys", () => {
  test("shares a key for the current epoch", async () => {
    const decoy = client();
    const shared = await decoy.viewKeys.share({ holder: "  Portfolio dashboard  " });
    assert.equal(shared.grant.holder, "Portfolio dashboard");
    assert.equal(shared.grant.status, "active");
    assert.equal(shared.grant.epoch, EPOCH);
    assert.ok(shared.key.length > 0);
    assert.equal(decoy.account().viewKeys[0], shared.grant);
  });

  test("revokes a key and moves the account to the next epoch", async () => {
    const decoy = client();
    const grant = await decoy.viewKeys.revoke("vk-active");
    assert.equal(grant.status, "revoked");
    assert.equal(decoy.account().epoch, nextEpoch(EPOCH));
  });

  test("refuses an empty holder, an unknown key and a revoked key", async () => {
    const decoy = client();
    await assert.rejects(decoy.viewKeys.share({ holder: "   " }), isDecoyError("emptyHolder"));
    await assert.rejects(decoy.viewKeys.revoke("vk-missing"), isDecoyError("unknownViewKey"));
    await assert.rejects(decoy.viewKeys.revoke("vk-revoked"), isDecoyError("viewKeyAlreadyRevoked"));
  });
});

describe("settings", () => {
  test("stores the RPC URL without surrounding spaces", async () => {
    const settings = await client().updateSettings({ rpcUrl: "  https://node.example:8547  " });
    assert.equal(settings.rpcUrl, "https://node.example:8547");
  });

  test("refuses an invalid RPC URL and an invalid auto-lock", async () => {
    const decoy = client();
    await assert.rejects(decoy.updateSettings({ rpcUrl: "ftp://node.example" }), isDecoyError("invalidRpcUrl"));
    await assert.rejects(decoy.updateSettings({ autoLockMinutes: 0 }), isDecoyError("invalidAutoLock"));
  });
});

describe("subscribe", () => {
  test("reports every change until the listener is removed", async () => {
    const decoy = client();
    const seen: Account[] = [];
    const unsubscribe = decoy.subscribe((account) => seen.push(account));
    await decoy.updateSettings({ autoChurn: false });
    unsubscribe();
    await decoy.updateSettings({ autoChurn: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].settings.autoChurn, false);
  });

  test("leaves the account untouched when a write is refused", async () => {
    const decoy = client();
    const before = decoy.account();
    await assert.rejects(decoy.withdraw({ asset: "USDG", amount: 0n, to: DESTINATION }), isDecoyError("invalidAmount"));
    assert.equal(decoy.account(), before);
  });
});
