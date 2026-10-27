import { describe, expect, it } from "vitest";

import { remainingAllowance, settlementPlan } from "./settlement";
import type { AidCard, Receipt } from "./types";

const card: AidCard = {
  id: "card-1",
  label: "Family 1",
  accountUuid: "account-1",
  unifiedAddress: "utest1example",
  allowanceZatoshis: 5_000_000,
  expiresAt: "2030-01-01T00:00:00.000Z",
  pinHash: "",
  payload: { v: 1, c: "card-1", n: "testnet", a: 5_000_000, x: "2030-01-01T00:00:00.000Z", ph: "", s: "" },
  fundingTxid: "txid",
  fundingHeight: null,
  status: "active",
  createdAt: "2026-10-27T00:00:00.000Z",
};

function receipt(id: string, amountZatoshis: number, createdAt: string): Receipt {
  return {
    id,
    cardId: card.id,
    vendorId: "vendor-1",
    amountZatoshis,
    createdAt,
    signature: "signature",
    status: "queued",
    txid: null,
    reason: null,
  };
}

describe("offline allowance settlement", () => {
  it("subtracts settled spending and local receipts from the allowance", () => {
    expect(
      remainingAllowance(
        5_000_000,
        2_000_000,
        [
          { cardId: card.id, amountZatoshis: 1_000_000, status: "offline" },
          { cardId: "other", amountZatoshis: 500_000, status: "offline" },
        ],
        card.id,
      ),
    ).toBe(2_000_000);
  });

  it("settles receipts in creation order and freezes on overdraft", () => {
    const decisions = settlementPlan(
      card,
      [
        receipt("later", 3_000_000, "2026-10-27T12:01:00.000Z"),
        receipt("first", 2_000_000, "2026-10-27T12:00:00.000Z"),
        receipt("third", 1_000_000, "2026-10-27T12:02:00.000Z"),
      ],
      Date.parse("2026-10-27T13:00:00.000Z"),
    );

    expect(decisions).toEqual([
      { receiptId: "first", status: "eligible", reason: null },
      { receiptId: "later", status: "eligible", reason: null },
      { receiptId: "third", status: "rejected_overdraft", reason: "Receipt exceeds the card's remaining allowance." },
    ]);
  });
});
