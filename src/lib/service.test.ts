import { describe, expect, it, vi } from "vitest";

import { ZecAidService } from "./service";
import { emptyStore, type ProgramStore } from "./store/types";
import type { ProgramData } from "./types";
import { DevtoolWallet } from "./wallet/devtool";

describe("card issuance funding preflight", () => {
  it("does not generate an account when the Treasury cannot cover the fee reserve and fee", async () => {
    let data: ProgramData = {
      ...emptyStore(),
      treasuryAccountUuid: "treasury-account",
      treasuryAddress: "treasury-address",
    };
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
    expect(data.cards).toHaveLength(0);
  });
});
