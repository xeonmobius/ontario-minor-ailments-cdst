import { NextResponse } from "next/server"
import { getPool, isPhiEnabled } from "@/lib/phi/db"

export async function GET() {
  if (!isPhiEnabled()) {
    return NextResponse.json({ status: "disabled", message: "PHI_PERSIST_ENABLED is not true" })
  }
  try {
    const pool = getPool()
    const client = await pool.connect()
    try {
      const res = await client.query("SELECT NOW() as now")
      return NextResponse.json({ status: "connected", time: res.rows[0].now })
    } finally {
      client.release()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ status: "error", message }, { status: 500 })
  }
}
