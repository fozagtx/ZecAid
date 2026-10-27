import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { publicKeyFromPrivate, createCardPayload, derivePinHash, verifyReceipt } from "./crypto";
import { ZecAidError } from "./errors";
import { zecToZatoshis } from "./money";
import { settlementPlan } from "./settlement";
import type {
  AidCard,
  AuditEvent,
  CardPayload,
  ProgramData,
  Receipt,
  ReceiptInput,
  WalletBalance,
} from "./types";
import type { ProgramStore } from "./store/types";
import { isUnifiedAddress } from "./addresses";
import { DevtoolWallet, type WalletStatus } from "./wallet/devtool";

const CARD_FEE_RESERVE = zecToZatoshis("0.001");
const MIN_CONFIRMATIONS = 2;

type NgoKeys = { privateKey: string; publicKey: string };
type PublicCard = Omit<AidCard, "accountUuid" | "pinHash"> & {
  balance: WalletBalance | null;
  settledSpentZatoshis: number;
};

function publicCard(card: AidCard, balance: WalletBalance | null, settledSpentZatoshis: number): PublicCard {
  const { accountUuid, pinHash, ...visible } = card;
  void accountUuid;
  void pinHash;
  return { ...visible, balance, settledSpentZatoshis };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeCompareHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function appendAudit(
  data: ProgramData,
  kind: string,
  detail: string,
  cardId: string | null = null,
  receiptId: string | null = null,
): void {
  const event: AuditEvent = {
    id: randomUUID(),
    cardId,
    receiptId,
    kind,
    timestamp: new Date().toISOString(),
    detail,
  };
  data.audit.unshift(event);
}

export class ZecAidService {
  private openPromise: Promise<{ treasuryAccountUuid: string; treasuryAddress: string }> | null = null;

  constructor(
    private readonly store: ProgramStore,
    private readonly wallet: DevtoolWallet,
  ) {}

  async openProgram(): Promise<{ treasuryAccountUuid: string; treasuryAddress: string; ngoPubKey: string }> {
    if (!this.openPromise) {
      this.openPromise = this.openOnce().finally(() => {
        this.openPromise = null;
      });
    }
    const program = await this.openPromise;
    const keys = await this.getNgoKeys();
    return { ...program, ngoPubKey: keys.publicKey };
  }

  private async openOnce(): Promise<{ treasuryAccountUuid: string; treasuryAddress: string }> {
    const treasury = await this.wallet.openProgram();
    const treasuryAddress = await this.wallet.getAddress(treasury.uuid);
    await this.store.update((data) => {
      data.treasuryAccountUuid = treasury.uuid;
      data.treasuryAddress = treasuryAddress;
      data.openedAt ??= new Date().toISOString();
    });
    await this.getNgoKeys();
    return { treasuryAccountUuid: treasury.uuid, treasuryAddress };
  }

  async getProgram(): Promise<{
    opened: boolean;
    treasuryAddress: string | null;
    treasuryBalance: WalletBalance | null;
    cards: PublicCard[];
    vendors: Omit<ProgramData["vendors"][number], "pairingCodeHash">[];
    cardCount: number;
    totalAllowanceZatoshis: number;
    settledZatoshis: number;
    pendingReceipts: number;
    chainHeight: number | null;
    lastSyncAt: string | null;
    walletReady: boolean;
  }> {
    const data = await this.store.read();
    const walletStatus = await this.wallet.status();
    if (!data.treasuryAccountUuid) {
      return {
        opened: false,
        treasuryAddress: null,
        treasuryBalance: null,
        cards: [],
        vendors: [],
        cardCount: 0,
        totalAllowanceZatoshis: 0,
        settledZatoshis: 0,
        pendingReceipts: 0,
        chainHeight: data.chainHeight,
        lastSyncAt: data.lastSyncAt,
        walletReady: walletStatus.ready,
      };
    }
    const [treasuryBalance, ...cardBalances] = await Promise.all([
      this.wallet.getBalance(data.treasuryAccountUuid),
      ...data.cards.map((card) => this.wallet.getBalance(card.accountUuid).catch(() => null)),
    ]);
    const spent = new Map<string, number>();
    for (const receipt of data.receipts) {
      if (receipt.status === "settled") {
        spent.set(receipt.cardId, (spent.get(receipt.cardId) ?? 0) + receipt.amountZatoshis);
      }
    }
    return {
      opened: true,
      treasuryAddress: data.treasuryAddress,
      treasuryBalance,
      cards: data.cards.map((card, index) =>
        publicCard(card, cardBalances[index] ?? null, spent.get(card.id) ?? 0),
      ),
      vendors: data.vendors.map(({ pairingCodeHash, ...vendor }) => {
        void pairingCodeHash;
        return vendor;
      }),
      cardCount: data.cards.length,
      totalAllowanceZatoshis: data.cards.reduce((sum, card) => sum + card.allowanceZatoshis, 0),
      settledZatoshis: data.receipts
        .filter((receipt) => receipt.status === "settled")
        .reduce((sum, receipt) => sum + receipt.amountZatoshis, 0),
      pendingReceipts: data.receipts.filter(
        (receipt) => receipt.status === "queued" || receipt.status === "awaiting_funds",
      ).length,
      chainHeight: data.chainHeight,
      lastSyncAt: data.lastSyncAt,
      walletReady: walletStatus.ready,
    };
  }

  async createCard(input: {
    label: string;
    allowanceZatoshis: number;
    expiresAt: string;
  }): Promise<{ card: PublicCard; pin: string }> {
    const data = await this.store.read();
    if (!data.treasuryAccountUuid) throw new ZecAidError("Open the program before issuing cards.", 409);
    if (!input.label.trim()) throw new ZecAidError("Enter a recipient label.", 400);
    if (!Number.isSafeInteger(input.allowanceZatoshis) || input.allowanceZatoshis <= 0) {
      throw new ZecAidError("Allowance must be a positive ZEC amount.", 400);
    }
    const expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ZecAidError("Expiry must be a future date.", 400);
    }

    const id = randomUUID();
    const pin = String(randomInt(100_000, 1_000_000));
    const account = await this.wallet.generateAccount(`card-${id.slice(0, 8)}`);
    const address = await this.wallet.getAddress(account.uuid);
    const pinHash = derivePinHash(pin, id);
    const keys = await this.getNgoKeys();
    const unsignedPayload = {
      v: 1 as const,
      c: id,
      n: "testnet" as const,
      a: input.allowanceZatoshis,
      x: expiresAt.toISOString(),
      ph: pinHash,
    };
    const payload: CardPayload = await createCardPayload(unsignedPayload, keys.privateKey);
    const fundingTxid = await this.wallet.send(
      data.treasuryAccountUuid,
      address,
      input.allowanceZatoshis + CARD_FEE_RESERVE,
      `ZecAid allowance ${id.slice(0, 8)}`,
    );
    const card: AidCard = {
      id,
      label: input.label.trim(),
      accountUuid: account.uuid,
      unifiedAddress: address,
      allowanceZatoshis: input.allowanceZatoshis,
      expiresAt: expiresAt.toISOString(),
      pinHash,
      payload,
      fundingTxid,
      fundingHeight: null,
      status: "funding",
      createdAt: new Date().toISOString(),
    };
    await this.store.update((draft) => {
      draft.cards.unshift(card);
      appendAudit(
        draft,
        "Card issued",
        `Allowance ${input.allowanceZatoshis} zatoshis; funding transaction ${fundingTxid}.`,
        id,
      );
    });
    return { card: publicCard(card, null, 0), pin };
  }

  async registerVendor(input: { name: string; unifiedAddress: string }): Promise<{
    vendor: Omit<ProgramData["vendors"][number], "pairingCodeHash">;
    pairingCode: string;
    pairingPath: string;
  }> {
    if (!input.name.trim()) throw new ZecAidError("Enter a vendor name.", 400);
    if (!isUnifiedAddress(input.unifiedAddress)) {
      throw new ZecAidError("Enter a valid Zcash testnet unified address.", 400);
    }
    const id = randomUUID();
    const pairingCode = randomBytes(24).toString("base64url");
    const vendor = {
      id,
      name: input.name.trim(),
      unifiedAddress: input.unifiedAddress,
      pairingCodeHash: sha256(pairingCode),
      publicKey: null,
      createdAt: new Date().toISOString(),
      pairedAt: null,
    };
    await this.store.update((data) => {
      data.vendors.unshift(vendor);
      appendAudit(data, "Vendor registered", `${vendor.name} added.`);
    });
    const { pairingCodeHash, ...publicVendor } = vendor;
    void pairingCodeHash;
    return { vendor: publicVendor, pairingCode, pairingPath: `/pos/pair?code=${encodeURIComponent(pairingCode)}` };
  }

  async pairVendor(code: string, vendorPubKey: string): Promise<{
    vendorId: string;
    vendorName: string;
    ngoPubKey: string;
    programName: string;
  }> {
    if (!/^[a-f0-9]{64}$/i.test(vendorPubKey)) throw new ZecAidError("Invalid vendor signing key.", 400);
    const candidateHash = sha256(code);
    const paired = await this.store.update((data) => {
      const vendor = data.vendors.find(
        (item) => item.pairingCodeHash && safeCompareHex(item.pairingCodeHash, candidateHash),
      );
      if (!vendor) throw new ZecAidError("Pairing link is invalid or already used.", 404);
      vendor.publicKey = vendorPubKey.toLowerCase();
      vendor.pairingCodeHash = null;
      vendor.pairedAt = new Date().toISOString();
      appendAudit(data, "Vendor paired", `${vendor.name} paired a POS device.`);
      return { id: vendor.id, name: vendor.name };
    });
    const keys = await this.getNgoKeys();
    return {
      vendorId: paired.id,
      vendorName: paired.name,
      ngoPubKey: keys.publicKey,
      programName: "ZecAid",
    };
  }

  async syncPos(vendorId: string, incoming: ReceiptInput[]): Promise<{
    snapshot: ReturnType<ZecAidService["getPosSnapshotFromData"]>;
    results: Array<{ id: string; status: Receipt["status"]; txid: string | null; reason: string | null }>;
  }> {
    const data = await this.store.read();
    const vendor = data.vendors.find((item) => item.id === vendorId && item.publicKey);
    if (!vendor?.publicKey) throw new ZecAidError("This POS is not paired with a vendor.", 403);
    await this.refresh();

    const invalid: Receipt[] = [];
    for (const item of incoming) {
      const existing = data.receipts.find((receipt) => receipt.id === item.id);
      if (existing) continue;
      if (
        item.vendorId !== vendorId ||
        !item.id ||
        !Number.isSafeInteger(item.amountZatoshis) ||
        item.amountZatoshis <= 0 ||
        !Number.isFinite(Date.parse(item.createdAt)) ||
        !(await verifyReceipt(item, vendor.publicKey))
      ) {
        invalid.push({
          ...item,
          status: "rejected_invalid",
          txid: null,
          reason: "Receipt signature or fields are invalid.",
        });
        continue;
      }
      const cardExists = data.cards.some((card) => card.id === item.cardId);
      await this.store.update((draft) => {
        if (draft.receipts.some((receipt) => receipt.id === item.id)) return;
        draft.receipts.push({
          ...item,
          status: cardExists ? "queued" : "rejected_invalid",
          txid: null,
          reason: cardExists ? null : "Card not found.",
        });
        appendAudit(draft, cardExists ? "Receipt queued" : "Receipt rejected", item.id, item.cardId, item.id);
      });
    }
    await this.settlePending();
    const latest = await this.store.read();
    const results = [...latest.receipts.filter((receipt) => receipt.vendorId === vendorId), ...invalid]
      .map(({ id, status, txid, reason }) => ({ id, status, txid, reason }));
    return { snapshot: this.getPosSnapshotFromData(latest, vendorId), results };
  }

  async getPosSnapshot(vendorId: string) {
    return this.getPosSnapshotFromData(await this.store.read(), vendorId);
  }

  private getPosSnapshotFromData(data: ProgramData, vendorId: string) {
    const settledSpentByCard: Record<string, number> = {};
    for (const receipt of data.receipts) {
      if (receipt.status === "settled") {
        settledSpentByCard[receipt.cardId] = (settledSpentByCard[receipt.cardId] ?? 0) + receipt.amountZatoshis;
      }
    }
    return {
      revokedCardIds: data.cards
        .filter((card) => card.status === "frozen" || card.status === "expired")
        .map((card) => card.id),
      settledSpentByCard,
      receiptStatuses: data.receipts
        .filter((receipt) => receipt.vendorId === vendorId)
        .map(({ id, status, txid, reason }) => ({ id, status, txid, reason })),
    };
  }

  async refresh(): Promise<void> {
    const initial = await this.store.read();
    if (!initial.treasuryAccountUuid) throw new ZecAidError("Open the program before syncing.", 409);
    await this.wallet.sync();
    const chainHeight = await this.wallet.getChainHeight().catch(() => initial.chainHeight);
    const cards = await this.store.read();
    const fundingUpdates = await Promise.all(
      cards.cards
        .filter((card) => card.status === "funding")
        .map(async (card) => {
          const tx = (await this.wallet.getTransactions(card.accountUuid)).find(
            (entry) => entry.txid === card.fundingTxid,
          );
          return { id: card.id, minedHeight: tx?.minedHeight ?? null };
        }),
    );
    await this.store.update((data) => {
      data.lastSyncAt = new Date().toISOString();
      data.chainHeight = chainHeight;
      for (const update of fundingUpdates) {
        const card = data.cards.find((item) => item.id === update.id);
        if (!card || card.status !== "funding") continue;
        card.fundingHeight = update.minedHeight;
        if (
          update.minedHeight !== null &&
          chainHeight !== null &&
          chainHeight - update.minedHeight + 1 >= MIN_CONFIRMATIONS
        ) {
          card.status = "active";
          appendAudit(data, "Card activated", "Funding has confirmed on Zcash testnet.", card.id);
        }
      }
      for (const card of data.cards) {
        if (card.status !== "frozen" && Date.parse(card.expiresAt) <= Date.now()) {
          card.status = "expired";
          appendAudit(data, "Card expired", "The allowance expiry date has passed.", card.id);
        }
      }
    });
    await this.settlePending();
  }

  async settlePending(): Promise<void> {
    const initial = await this.store.read();
    for (const card of initial.cards) {
      const current = await this.store.read();
      const currentCard = current.cards.find((item) => item.id === card.id);
      if (!currentCard) continue;
      const decisions = settlementPlan(
        currentCard,
        current.receipts.filter((receipt) => receipt.cardId === currentCard.id),
      );
      for (const decision of decisions) {
        const receipt = (await this.store.read()).receipts.find((item) => item.id === decision.receiptId);
        if (!receipt || receipt.status === "settled") continue;
        if (decision.status !== "eligible") {
          await this.updateReceipt(receipt.id, decision.status, null, decision.reason);
          if (decision.status === "rejected_overdraft") {
            await this.store.update((data) => {
              const target = data.cards.find((item) => item.id === currentCard.id);
              if (target && target.status !== "frozen") {
                target.status = "frozen";
                appendAudit(data, "Card frozen", "Offline receipts exceeded the allowance.", target.id, receipt.id);
              }
            });
          }
          continue;
        }
        const vendor = current.vendors.find((item) => item.id === receipt.vendorId);
        if (!vendor) {
          await this.updateReceipt(receipt.id, "rejected_invalid", null, "Vendor not found.");
          continue;
        }
        try {
          const fee = await this.wallet.estimateFee(
            currentCard.accountUuid,
            vendor.unifiedAddress,
            receipt.amountZatoshis,
          );
          const balance = await this.wallet.getBalance(currentCard.accountUuid);
          if (balance.spendableZatoshis < receipt.amountZatoshis + fee) {
            await this.updateReceipt(
              receipt.id,
              "awaiting_funds",
              null,
              "Card funds are not spendable yet; it will retry after confirmations.",
            );
            continue;
          }
          const txid = await this.wallet.send(
            currentCard.accountUuid,
            vendor.unifiedAddress,
            receipt.amountZatoshis,
            `ZecAid receipt ${receipt.id.slice(0, 8)}`,
          );
          await this.updateReceipt(receipt.id, "settled", txid, null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/insufficient|spendable|confirm/i.test(message)) {
            await this.updateReceipt(receipt.id, "awaiting_funds", null, message);
          } else {
            throw error;
          }
        }
      }
    }
  }

  private async updateReceipt(
    id: string,
    status: Receipt["status"],
    txid: string | null,
    reason: string | null,
  ): Promise<void> {
    await this.store.update((data) => {
      const receipt = data.receipts.find((item) => item.id === id);
      if (!receipt || (receipt.status === "settled" && status !== "settled")) return;
      const changed = receipt.status !== status || receipt.txid !== txid || receipt.reason !== reason;
      receipt.status = status;
      receipt.txid = txid;
      receipt.reason = reason;
      if (changed) appendAudit(data, `Receipt ${status}`, reason ?? txid ?? id, receipt.cardId, id);
    });
  }

  async getStatements(accountId: string, revealViewingKey: boolean): Promise<{
    accountName: string;
    transactions: Awaited<ReturnType<DevtoolWallet["getTransactions"]>>;
    viewingKey?: string;
  }> {
    const data = await this.store.read();
    const account = accountId === "treasury"
      ? { uuid: data.treasuryAccountUuid, name: "Treasury" }
      : (() => {
          const card = data.cards.find((item) => item.id === accountId);
          return card ? { uuid: card.accountUuid, name: card.label } : null;
        })();
    if (!account?.uuid) throw new ZecAidError("Account not found.", 404);
    const transactions = await this.wallet.getTransactions(account.uuid);
    return {
      accountName: account.name,
      transactions,
      ...(revealViewingKey ? { viewingKey: await this.wallet.getViewingKey(account.uuid) } : {}),
    };
  }

  async getAudit() {
    return (await this.store.read()).audit;
  }

  async getSettlements() {
    return (await this.store.read()).receipts.slice().sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
  }

  async getSettings(): Promise<WalletStatus> {
    return this.wallet.status();
  }

  async getCard(id: string): Promise<PublicCard> {
    const data = await this.store.read();
    const card = data.cards.find((item) => item.id === id);
    if (!card) throw new ZecAidError("Card not found.", 404);
    const [balance] = await Promise.all([this.wallet.getBalance(card.accountUuid)]);
    const settledSpent = data.receipts
      .filter((receipt) => receipt.cardId === card.id && receipt.status === "settled")
      .reduce((sum, receipt) => sum + receipt.amountZatoshis, 0);
    return publicCard(card, balance, settledSpent);
  }

  async getNgoPublicKey(): Promise<string> {
    return (await this.getNgoKeys()).publicKey;
  }

  private async getNgoKeys(): Promise<NgoKeys> {
    const keyPath = path.join(this.wallet.vaultDir, "ngo-signing-key.json");
    try {
      const keys = JSON.parse(await readFile(keyPath, "utf8")) as NgoKeys;
      if (await publicKeyFromPrivate(keys.privateKey) !== keys.publicKey) {
        throw new Error("NGO signing key file does not match its public key.");
      }
      return keys;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const privateKey = randomBytes(32).toString("hex");
    const keys = { privateKey, publicKey: await publicKeyFromPrivate(privateKey) };
    await mkdir(this.wallet.vaultDir, { recursive: true });
    await writeFile(keyPath, JSON.stringify(keys, null, 2), { mode: 0o600, flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
      const existing = JSON.parse(await readFile(keyPath, "utf8")) as NgoKeys;
      keys.privateKey = existing.privateKey;
      keys.publicKey = existing.publicKey;
    });
    await chmod(keyPath, 0o600);
    return keys;
  }
}
