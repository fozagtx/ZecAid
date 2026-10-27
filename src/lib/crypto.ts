import { getPublicKeyAsync, signAsync, utils, verifyAsync } from "@noble/ed25519";
import { scrypt } from "@noble/hashes/scrypt.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import type { CardPayload, ReceiptInput } from "./types";

const PIN_OPTIONS = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };

export type UnsignedCardPayload = Omit<CardPayload, "s">;

export function canonicalCardPayload(payload: UnsignedCardPayload): string {
  return JSON.stringify({
    v: payload.v,
    c: payload.c,
    n: payload.n,
    a: payload.a,
    x: payload.x,
    ph: payload.ph,
  });
}

export async function createCardPayload(
  payload: UnsignedCardPayload,
  privateKeyHex: string,
): Promise<CardPayload> {
  const signature = await signAsync(
    utf8ToBytes(canonicalCardPayload(payload)),
    hexToBytes(privateKeyHex),
  );
  return { ...payload, s: bytesToHex(signature) };
}

export async function verifyCardPayload(
  payload: CardPayload,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    if (
      payload.v !== 1 ||
      payload.n !== "testnet" ||
      !payload.c ||
      !Number.isSafeInteger(payload.a) ||
      payload.a <= 0 ||
      !Number.isFinite(Date.parse(payload.x)) ||
      !/^[a-f0-9]{64}$/i.test(payload.ph)
    ) {
      return false;
    }
    return await verifyAsync(
      hexToBytes(payload.s),
      utf8ToBytes(canonicalCardPayload(payload)),
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
}

export function derivePinHash(pin: string, cardId: string): string {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must contain six digits.");
  return bytesToHex(scrypt(pin, `zecaid:${cardId}`, PIN_OPTIONS));
}

export function verifyPin(pin: string, cardId: string, expectedHash: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  try {
    return constantTimeHexEqual(derivePinHash(pin, cardId), expectedHash);
  } catch {
    return false;
  }
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  try {
    const a = hexToBytes(left);
    const b = hexToBytes(right);
    let diff = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

export function canonicalReceipt(input: Omit<ReceiptInput, "signature">): string {
  return JSON.stringify({
    id: input.id,
    cardId: input.cardId,
    vendorId: input.vendorId,
    amountZatoshis: input.amountZatoshis,
    createdAt: input.createdAt,
  });
}

export async function signReceipt(
  input: Omit<ReceiptInput, "signature">,
  privateKeyHex: string,
): Promise<ReceiptInput> {
  const signature = await signAsync(
    utf8ToBytes(canonicalReceipt(input)),
    hexToBytes(privateKeyHex),
  );
  return { ...input, signature: bytesToHex(signature) };
}

export async function verifyReceipt(
  receipt: ReceiptInput,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    if (!Number.isSafeInteger(receipt.amountZatoshis) || receipt.amountZatoshis <= 0) {
      return false;
    }
    return await verifyAsync(
      hexToBytes(receipt.signature),
      utf8ToBytes(canonicalReceipt(receipt)),
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
}

export async function createEd25519KeyPair(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  const secretKey = utils.randomSecretKey();
  return {
    privateKey: bytesToHex(secretKey),
    publicKey: bytesToHex(await getPublicKeyAsync(secretKey)),
  };
}

export async function publicKeyFromPrivate(privateKeyHex: string): Promise<string> {
  return bytesToHex(await getPublicKeyAsync(hexToBytes(privateKeyHex)));
}
