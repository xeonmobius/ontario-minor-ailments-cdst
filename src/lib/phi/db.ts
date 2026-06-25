import { Pool } from "pg"

let pool: Pool | null = null

export function isPhiEnabled(): boolean {
  return process.env.PHI_PERSIST_ENABLED === "true"
}

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set")
    }
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.PHI_DB_SSL === "false" ? false : { rejectUnauthorized: false },
    })
  }
  return pool
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!isPhiEnabled()) return []
  const client = await getPool().connect()
  try {
    const result = await client.query<T>(text, params)
    return result.rows
  } finally {
    client.release()
  }
}
