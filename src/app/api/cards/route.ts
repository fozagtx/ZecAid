import { z } from "zod";

import { zecToZatoshis } from "@/lib/money";
import { handle, readJson } from "@/lib/server/http";
import { getService } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cardSchema = z.object({
  label: z.string().trim().min(1).max(120),
  allowanceZec: z.string().regex(/^\d+(\.\d{1,8})?$/),
  expiresAt: z.string().datetime({ offset: true }),
});

export function POST(request: Request) {
  return handle(async () => {
    const input = cardSchema.parse(await readJson(request));
    return getService().createCard({
      label: input.label,
      allowanceZatoshis: zecToZatoshis(input.allowanceZec),
      expiresAt: input.expiresAt,
    });
  });
}
