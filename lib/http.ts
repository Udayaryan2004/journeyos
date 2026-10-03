import { NextResponse } from "next/server";
import { HttpError } from "./db";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(status: number, code: string, message?: string) {
  return NextResponse.json(
    { error: { code, message: message ?? code, requestId: crypto.randomUUID() } },
    { status },
  );
}

/** One place that turns thrown errors into the documented error envelope. */
export function handle(err: unknown) {
  if (err instanceof HttpError) return fail(err.status, err.code, err.message);
  const message = err instanceof Error ? err.message : "Unexpected error";
  console.error("[api]", err);
  return fail(500, "INTERNAL", message);
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "VALIDATION_FAILED", "Body must be valid JSON");
  }
}
