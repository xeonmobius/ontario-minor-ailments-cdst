import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

// The June 2026 scaffold shipped `--font-sans: var(--font-sans)` — a circular
// theme variable that silently resolved to nothing, so the whole app rendered
// in the browser's serif fallback for months. Nobody noticed because no check
// ever parsed the tokens. This test makes circularity a hard failure: within
// each CSS custom-property block, a variable may not reference itself.

const globalsPath = path.resolve(__dirname, "../app/globals.css")

function parseDefinitions(css: string): Map<string, string[]> {
  const defined = new Map<string, string[]>()
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi
  for (const [, name, value] of css.matchAll(re)) {
    const refs = [...value.matchAll(/var\(\s*--([a-z0-9-]+)\s*[,)]/gi)].map(
      (m) => m[1],
    )
    defined.set(name, refs)
  }
  return defined
}

describe("design tokens (globals.css)", () => {
  it("defines no variable in terms of itself (direct cycle)", () => {
    const css = fs.readFileSync(globalsPath, "utf8")
    const defined = parseDefinitions(css)
    const cycles = [...defined.entries()]
      .filter(([name, refs]) => refs.includes(name))
      .map(([name]) => `--${name}`)
    expect(cycles).toEqual([])
  })

  it("defines no variable with a circular reference chain", () => {
    const css = fs.readFileSync(globalsPath, "utf8")
    const defined = parseDefinitions(css)

    const cyclic: string[] = []
    const visiting = new Set<string>()
    const visit = (name: string) => {
      if (visiting.has(name)) {
        cyclic.push(`--${name}`)
        return
      }
      const refs = defined.get(name)
      if (!refs) return
      visiting.add(name)
      for (const ref of refs) visit(ref)
      visiting.delete(name)
    }
    for (const name of defined.keys()) visit(name)
    expect(cyclic).toEqual([])
  })
})
