import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, handle } from "@/lib/http";
import { MODELS, hasApiKey } from "@/lib/ai/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    const admin = await requireAdmin();

    const [totals, byStatus, ai, recent, compliance] = await Promise.all([
      q<{ users: string; trips: string; plans: string; messages: string }>(
        `select
           (select count(*) from users where deleted_at is null) as users,
           (select count(*) from trips where status <> 'archived') as trips,
           (select count(*) from trips where status in ('planned','upcoming','active','completed')) as plans,
           (select count(*) from messages) as messages`,
      ),
      q<{ status: string; n: string }>(
        `select status::text, count(*) as n from trips group by status order by n desc`,
      ),
      q<{ model: string | null; calls: string; tokens_in: string; tokens_out: string; cost: string }>(
        `select model, count(*) as calls,
                coalesce(sum(tokens_in),0) as tokens_in,
                coalesce(sum(tokens_out),0) as tokens_out,
                coalesce(sum(cost_usd),0) as cost
           from messages where role = 'assistant'
          group by model order by calls desc`,
      ),
      q<{ id: string; title: string; status: string; email: string; updated_at: Date }>(
        `select t.id, t.title, t.status::text, u.email, t.updated_at
           from trips t join users u on u.id = t.user_id
          where t.status <> 'archived'
          order by t.updated_at desc limit 10`,
      ),
      q<{ severity: string; n: string }>(
        `select severity::text, count(*) as n from compliance_checks group by severity`,
      ),
    ]);

    const costToday = Number(ai.reduce((s, r) => s + Number(r.cost), 0).toFixed(4));
    const cap = Number(process.env.AI_DAILY_CAP_USD ?? 10);

    return ok({
      admin: admin.email,
      aiProvider: {
        configured: hasApiKey,
        planner: MODELS.planner,
        extractor: MODELS.extractor,
        mode: hasApiKey ? "live" : "deterministic fallback (no OPENAI_API_KEY)",
      },
      totals: {
        users: Number(totals[0].users),
        trips: Number(totals[0].trips),
        plansCompleted: Number(totals[0].plans),
        messages: Number(totals[0].messages),
      },
      tripsByStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.n) })),
      ai: ai.map((r) => ({
        model: r.model ?? "fallback",
        calls: Number(r.calls),
        tokensIn: Number(r.tokens_in),
        tokensOut: Number(r.tokens_out),
        costUsd: Number(Number(r.cost).toFixed(4)),
      })),
      spend: { todayUsd: costToday, dailyCapUsd: cap, pctOfCap: cap ? Math.round((costToday / cap) * 100) : 0 },
      compliance: compliance.map((r) => ({ severity: r.severity, count: Number(r.n) })),
      recentTrips: recent.map((r) => ({
        id: r.id, title: r.title, status: r.status, email: r.email, updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (err) {
    return handle(err);
  }
}
