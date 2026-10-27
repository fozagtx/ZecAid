import { z } from "zod";

import { handle, readJson } from "@/lib/server/http";
import { getService } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const receiptSchema = z.object({
  id: z.string().min(1).max(80),
  cardId: z.string().uuid(),
  vendorId: z.string().uuid(),
  amountZatoshis: z.number().int().positive().safe(),
  createdAt: z.string().datetime({ offset: true }),
  signature: z.string().regex(/^[a-f0-9]{128}$/i),
});

const syncSchema = z.object({
  vendorId: z.string().uuid(),
  receipts: z.array(receiptSchema).max(200),
});

export function POST(request: Request) {
  return handle(async () => {
    const input = syncSchema.parse(await readJson(request));
    return getService().syncPos(input.vendorId, input.receipts);
  });
}
