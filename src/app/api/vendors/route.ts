import { z } from "zod";

import { handle, readJson } from "@/lib/server/http";
import { getService } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const vendorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  unifiedAddress: z.string().min(20).max(512),
});

export function POST(request: Request) {
  return handle(async () => getService().registerVendor(vendorSchema.parse(await readJson(request))));
}
