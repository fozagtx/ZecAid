import { ZecAidError } from "@/lib/errors";
import { handle } from "@/lib/server/http";
import { getService } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handle(() => {
    const vendorId = new URL(request.url).searchParams.get("vendorId");
    if (!vendorId) throw new ZecAidError("Vendor ID is required.", 400);
    return getService().getPosSnapshot(vendorId);
  });
}
