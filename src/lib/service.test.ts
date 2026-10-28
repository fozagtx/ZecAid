import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ZecAidService } from "./service";
import { emptyStore, type ProgramStore } from "./store/types";
import type { ProgramData } from "./types";
import { DevtoolWallet } from "./wallet/devtool";

function makeStore(initial: ProgramData) {
  let data = structuredClone(initial);
  const store: ProgramStore = {
    async read() {
      return structuredClone(data);
    },
    async update<T>(change: (draft: ProgramData) => T | Promise<T>) {
      const draft = structuredClone(data);
      const result = await change(draft);
      data = draft;
      return result;
    },
  };
  return { store, getData: () => data };
}

describe("card issuance funding preflight", () => {
  it("does not generate an account when the Treasury cannot cover the fee reserve and fee", async () => {
    const initial: ProgramData = {
      ...emptyStore(),
      treasuryAccountUuid: "treasury-account",
      treasuryAddress: "treasury-address",
    };
    const { store, getData } = makeStore(initial);
    const wallet = {
      sync: vi.fn().mockResolvedValue(undefined),
      getBalance: vi.fn().mockResolvedValue({
        totalZatoshis: 5_100_000,
        spendableZatoshis: 5_100_000,
        chainHeight: 100,
      }),
      estimateFee: vi.fn().mockResolvedValue(25_000),
      generateAccount: vi.fn(),
    } as unknown as DevtoolWallet;
    const service = new ZecAidService(store, wallet);

    await expect(service.createCard({
      label: "Recipient",
      allowanceZatoshis: 5_000_000,
      expiresAt: "2030-01-01T00:00:00.000Z",
    })).rejects.toThrow("Treasury funds are still confirming");

    expect(wallet.sync).toHaveBeenCalledWith(true);
    expect(wallet.generateAccount).not.toHaveBeenCalled();
    expect(getData().cards).toHaveLength(0);
  });
});

describe("vendor wallet payout", () => {
  const code = "pairing-code-that-is-long-enough";
  const pairingCodeHash = createHash("sha256").update(code).digest("hex");
  const vendorAddress = `utest1${"b".repeat(80)}`;
  const payoutAddress = `utest1${"c".repeat(80)}`;
  const vendorPubKey = "a".repeat(64);

  function createPairingService() {
    const initial: ProgramData = {
      ...emptyStore(),
      vendors: [{
        id: "vendor-id",
        name: "Market",
        unifiedAddress: vendorAddress,
        payoutAddress: null,
        pairingCodeHash,
        publicKey: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        pairedAt: null,
      }],
    };
    const { store, getData } = makeStore(initial);
    const service = new ZecAidService(store, {} as DevtoolWallet);
    vi.spyOn(
      service as unknown as { getNgoKeys: () => Promise<{ privateKey: string; publicKey: string }> },
      "getNgoKeys",
    ).mockResolvedValue({ privateKey: "", publicKey: "d".repeat(64) });
    return { service, getData };
  }

  it("accepts a valid wallet payout address and audits the override", async () => {
    const { service, getData } = createPairingService();

    const result = await service.pairVendor(code, vendorPubKey, payoutAddress);

    expect(result.payoutAddress).toBe(payoutAddress);
    expect(getData().vendors[0].payoutAddress).toBe(payoutAddress);
    expect(getData().audit.map((event) => event.kind)).toContain("Vendor payout address updated");
    expect(getData().audit.find((event) => event.kind === "Vendor payout address updated")?.detail).toContain(payoutAddress);
  });

  it("rejects an invalid payout address without consuming the pairing code", async () => {
    const { service, getData } = createPairingService();

    await expect(service.pairVendor(code, vendorPubKey, "not-a-testnet-address"))
      .rejects.toThrow("valid Zcash testnet payout address");

    expect(getData().vendors[0].pairingCodeHash).toBe(pairingCodeHash);
    expect(getData().vendors[0].publicKey).toBeNull();
    expect(getData().audit).toHaveLength(0);
  });
});
