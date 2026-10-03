import { q, one, HttpError } from "@/lib/db";
import { hashPassword, passwordProblem, revokeAll } from "@/lib/auth";
import { ok, handle, body } from "@/lib/http";
import { createHash } from "crypto";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const b = await body<{ token?: string; password?: string }>(req);
    const problem = passwordProblem(b.password ?? "");
    if (problem) throw new HttpError(400, "VALIDATION_FAILED", problem);

    const hash = createHash("sha256").update(b.token ?? "").digest("hex");
    const row = await one<{ id: string; user_id: string }>(
      `select id, user_id from auth_tokens
        where token_hash = $1 and purpose = 'reset'
          and used_at is null and expires_at > now()`,
      [hash],
    );
    if (!row) throw new HttpError(400, "VALIDATION_FAILED", "That link has expired. Request a new one.");

    await q(`update users set password_hash = $2 where id = $1`, [row.user_id, await hashPassword(b.password!)]);
    await q(`update auth_tokens set used_at = now() where id = $1`, [row.id]);

    // changing a password signs out every other device
    await revokeAll(row.user_id);

    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
