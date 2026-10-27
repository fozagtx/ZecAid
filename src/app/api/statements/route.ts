import { ZecAidError } from "@/lib/errors";
import { handle } from "@/lib/server/http";
import { getService } from "@/lib/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handle(() => {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");
    if (!accountId) throw new ZecAidError("Account ID is required.", 400);
    return getService().getStatements(accountId, url.searchParams.get("reveal") === "1");
  });
}
