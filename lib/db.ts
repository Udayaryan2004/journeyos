import { Pool, type QueryResultRow } from "pg";

const globalForDb = globalThis as unknown as { __jospool?: Pool };

export const pool =
  globalForDb.__jospool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://journeyos:journeyos@localhost:5433/journeyos",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__jospool = pool;

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function q<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(sql, params);
  return res.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on a malformed uuid literal, which would surface as a 500. */
export const isUuid = (v: string): boolean => UUID_RE.test(v);

/**
 * Every trip read goes through this. Ownership is checked in SQL, not in JS,
 * so a forgotten `where user_id` can't leak another user's trip.
 */
export async function ownedTrip<T extends QueryResultRow = QueryResultRow>(
  tripId: string,
  userId: string,
): Promise<T> {
  // a malformed id is "not found", not a server error
  if (!isUuid(tripId)) throw new HttpError(404, "TRIP_NOT_FOUND", "No such trip");
  const trip = await one<T>(`select * from trips where id = $1 and user_id = $2`, [tripId, userId]);
  if (!trip) throw new HttpError(404, "TRIP_NOT_FOUND", "No such trip");
  return trip;
}

export async function tx<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
