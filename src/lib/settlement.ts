import type { AidCard, Receipt, ReceiptStatus } from "./types";

export type SettlementDecision = {
  receiptId: string;
  status: "eligible" | "awaiting_funds" | Extract<
    ReceiptStatus,
    "rejected_overdraft" | "rejected_frozen" | "rejected_expired"
  >;
  reason: string | null;
};

export function settlementPlan(
  card: AidCard,
  receipts: readonly Receipt[],
  now = Date.now(),
): SettlementDecision[] {
  const ordered = receipts
    .filter((receipt) => receipt.cardId === card.id)
    .slice()
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  let reservedZatoshis = 0;
  let frozenByOverdraft = card.status === "frozen";
  const expired = card.status === "expired" || Date.parse(card.expiresAt) <= now;
  const decisions: SettlementDecision[] = [];

  for (const receipt of ordered) {
    if (receipt.status === "settled") {
      reservedZatoshis += receipt.amountZatoshis;
      continue;
    }
    if (
      receipt.status !== "queued" &&
      receipt.status !== "awaiting_funds"
    ) {
      continue;
    }

    if (frozenByOverdraft) {
      decisions.push({
        receiptId: receipt.id,
        status: "rejected_frozen",
        reason: "Card frozen after an allowance limit was exceeded.",
      });
      continue;
    }
    if (expired) {
      decisions.push({
        receiptId: receipt.id,
        status: "rejected_expired",
        reason: "Card allowance has expired.",
      });
      continue;
    }
    if (reservedZatoshis + receipt.amountZatoshis > card.allowanceZatoshis) {
      frozenByOverdraft = true;
      decisions.push({
        receiptId: receipt.id,
        status: "rejected_overdraft",
        reason: "Receipt exceeds the card's remaining allowance.",
      });
      continue;
    }

    reservedZatoshis += receipt.amountZatoshis;
    decisions.push({
      receiptId: receipt.id,
      status: card.status === "funding" ? "awaiting_funds" : "eligible",
      reason: card.status === "funding" ? "Card funding is awaiting confirmations." : null,
    });
  }

  return decisions;
}

export function remainingAllowance(
  allowanceZatoshis: number,
  settledSpentZatoshis: number,
  localReceipts: readonly { cardId: string; amountZatoshis: number; status?: string }[],
  cardId: string,
): number {
  const locallyReserved = localReceipts
    .filter(
      (receipt) =>
        receipt.cardId === cardId &&
        (!receipt.status || ["offline", "queued", "awaiting_funds"].includes(receipt.status)),
    )
    .reduce((total, receipt) => total + receipt.amountZatoshis, 0);
  return Math.max(0, allowanceZatoshis - settledSpentZatoshis - locallyReserved);
}
