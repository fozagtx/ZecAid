import { z } from "zod";

import { handle, readJson } from "@/lib/server/http";
import { getService } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pairSchema = z.object({
  code: z.string().min(20).max(128),
  vendorPubKey: z.string().regex(/^[a-f0-9]{64}$/i),
  payoutAddress: z.string().min(20).max(512).optional(),
});

export function POST(request: Request) {
  return handle(async () => {
    const { code, vendorPubKey, payoutAddress } = pairSchema.parse(await readJson(request));
    return getService().pairVendor(code, vendorPubKey, payoutAddress);
  });
}
