#!/usr/bin/env node
// Pre-deploy drift check: every variable documented in .env.example must be
// present in Vercel (any scope). The 2026-11-04 POLAR_SANDBOX incident — a
// var in the spec and .env.example but never added to the deploy target,
// causing a production checkout 401 — is what this exists to catch.
//
// Usage: npx tsx scripts/check-env.ts   (requires `vercel` CLI auth + link)

import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const examplePath = path.resolve(__dirname, "../.env.example")
const documented = fs
  .readFileSync(examplePath, "utf8")
  .split("\n")
  .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
  .map((l) => l.split("=")[0])

const live = execSync("npx vercel env ls 2>/dev/null", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
})

const liveNames = new Set(
  live
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((n) => /^[A-Z_][A-Z0-9_]*$/.test(n)),
)

const missing = documented.filter((name) => !liveNames.has(name))

if (missing.length) {
  console.error("Env drift — documented in .env.example but missing on Vercel:")
  for (const name of missing) console.error(`  ${name}`)
  console.error("\nAdd with: npx vercel env add <NAME> --environment production")
  process.exit(1)
}

console.log(`Env check OK — all ${documented.length} documented variables present on Vercel.`)
