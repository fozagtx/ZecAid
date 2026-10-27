import { describe, expect, it } from "vitest";

import {
  createCardPayload,
  derivePinHash,
  publicKeyFromPrivate,
  signReceipt,
  verifyCardPayload,
  verifyPin,
  verifyReceipt,
} from "./crypto";

const privateKey = "01".repeat(32);

describe("card and receipt cryptography", () => {
  it("signs card payloads and rejects a changed allowance", async () => {
    const publicKey = await publicKeyFromPrivate(privateKey);
    const payload = await createCardPayload(
      { v: 1, c: "card-1", n: "testnet", a: 5_000_000, x: "2030-01-01T00:00:00.000Z", ph: "ab".repeat(32) },
      privateKey,
    );

    expect(await verifyCardPayload(payload, publicKey)).toBe(true);
    expect(await verifyCardPayload({ ...payload, a: 6_000_000 }, publicKey)).toBe(false);
  });

  it("checks the six-digit PIN against a card-specific scrypt hash", () => {
    const hash = derivePinHash("482901", "card-1");
    expect(verifyPin("482901", "card-1", hash)).toBe(true);
    expect(verifyPin("482902", "card-1", hash)).toBe(false);
  });

  it("verifies vendor-signed receipts", async () => {
    const publicKey = await publicKeyFromPrivate(privateKey);
    const unsigned = {
      id: "receipt-1",
      cardId: "card-1",
      vendorId: "vendor-1",
      amountZatoshis: 10_000,
      createdAt: "2026-10-27T12:00:00.000Z",
    };
    const receipt = await signReceipt(unsigned, privateKey);

    expect(await verifyReceipt(receipt, publicKey)).toBe(true);
    expect(await verifyReceipt({ ...receipt, amountZatoshis: 20_000 }, publicKey)).toBe(false);
  });
});
