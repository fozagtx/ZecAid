export type WalletBalance = {
  totalZatoshis: number;
  spendableZatoshis: number;
  chainHeight: number | null;
};

export type CardStatus = "funding" | "active" | "frozen" | "expired";

export type CardPayload = {
  v: 1;
  c: string;
  n: "testnet";
  a: number;
  x: string;
  ph: string;
  s: string;
};

export type AidCard = {
  id: string;
  label: string;
  accountUuid: string;
  unifiedAddress: string;
  allowanceZatoshis: number;
  expiresAt: string;
  pinHash: string;
  payload: CardPayload;
  fundingTxid: string;
  fundingHeight: number | null;
  status: CardStatus;
  createdAt: string;
};

export type Vendor = {
  id: string;
  name: string;
  unifiedAddress: string;
  payoutAddress?: string | null;
  pairingCodeHash: string | null;
  publicKey: string | null;
  createdAt: string;
  pairedAt: string | null;
};

export type ReceiptStatus =
  | "queued"
  | "awaiting_funds"
  | "settled"
  | "rejected_overdraft"
  | "rejected_frozen"
  | "rejected_expired"
  | "rejected_invalid";

export type Receipt = {
  id: string;
  cardId: string;
  vendorId: string;
  amountZatoshis: number;
  createdAt: string;
  signature: string;
  status: ReceiptStatus;
  txid: string | null;
  reason: string | null;
};

export type ReceiptInput = Pick<
  Receipt,
  "id" | "cardId" | "vendorId" | "amountZatoshis" | "createdAt" | "signature"
>;

export type AuditEvent = {
  id: string;
  cardId: string | null;
  receiptId: string | null;
  kind: string;
  timestamp: string;
  detail: string;
};

export type ProgramData = {
  treasuryAccountUuid: string | null;
  treasuryAddress: string | null;
  openedAt: string | null;
  lastSyncAt: string | null;
  chainHeight: number | null;
  cards: AidCard[];
  vendors: Vendor[];
  receipts: Receipt[];
  audit: AuditEvent[];
};

export type StoreData = ProgramData;
