import { ZodError } from "zod";

import { ZecAidError } from "../errors";

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ZecAidError("Expected a JSON body.", 400);
  }
}

export async function handle(action: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await action());
  } catch (error) {
    if (error instanceof ZecAidError) {
      return Response.json(
        { error: error.message, details: error.details ?? null },
        { status: error.status },
      );
    }
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid request", details: error.flatten() },
        { status: 400 },
      );
    }
    console.error(error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
