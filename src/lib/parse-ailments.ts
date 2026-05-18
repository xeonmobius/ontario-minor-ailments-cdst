import fs from "fs"
import path from "path"
import type { Ailment, RxOption } from "@/types"

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\*/g, "").trim()
}

function extractListItems(lines: string[]): string[] {
  return lines
    .filter(l => l.startsWith("- "))
    .map(l => l.replace(/^-\s+/, "").trim())
    .filter(Boolean)
}

function extractRxTable(lines: string[]): RxOption[] {
  const rows: RxOption[] = []
  let inTable = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        inTable = true
        continue
      }
      if (trimmed.match(/^\|[\s-|]+\|$/)) continue
      const cells = trimmed.split("|").filter(Boolean).map(c => stripMarkdown(c.trim()))
      if (cells.length >= 3) {
        rows.push({ drug: cells[0], dose: cells[1], notes: cells[2] })
      }
    } else {
      inTable = false
    }
  }
  return rows
}

function findSectionContent(
  lines: string[],
  heading: string,
  stopHeadings: string[]
): string[] {
  const lowerHeading = heading.toLowerCase()
  const lowerStop = stopHeadings.map(h => h.toLowerCase())
  let collecting = false
  const result: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("#")) {
      const lower = trimmed.toLowerCase()
      if (collecting) {
        if (lowerStop.some(s => lower.includes(s))) break
        continue
      }
      if (lower.includes(lowerHeading)) {
        collecting = true
      }
      continue
    }
    if (collecting) {
      result.push(line)
    }
  }
  return result
}

function sectionContains(lines: string[], keyword: string): boolean {
  return lines.some(l => l.trim().toLowerCase().includes(keyword.toLowerCase()))
}

function parseSimpleCard(lines: string[]): {
  symptoms: string[]
  redFlags: string[]
  rxOptions: RxOption[]
} {
  const symptomsContent = findSectionContent(lines, "symptoms", ["red flags"])
  const redFlagsContent = findSectionContent(lines, "red flags", ["rx options"])
  const rxContent = findSectionContent(lines, "rx", ["non-rx", "non rx"])

  return {
    symptoms: extractListItems(symptomsContent),
    redFlags: extractListItems(redFlagsContent),
    rxOptions: extractRxTable(rxContent),
  }
}

export function parseAilmentFile(
  content: string,
  filename: string,
  id: string,
  slug: string
): Ailment {
  const lines = content.split("\n")
  const name = lines[0].replace(/^#\s+/, "").trim()

  const hasSubConditions = content.includes("\n---\n")

  let symptoms: string[]
  let redFlags: string[]
  let rxOptions: RxOption[]

  if (hasSubConditions) {
    const allSymptoms: string[] = []
    const allRedFlags: string[] = []
    const allRxOptions: RxOption[] = []

    const sections = content.split("\n---\n")
    for (const section of sections) {
      const secLines = section.split("\n")
      if (sectionContains(secLines, "symptoms") && sectionContains(secLines, "red flags")) {
        const parsed = parseSimpleCard(secLines)
        allSymptoms.push(...parsed.symptoms)
        allRedFlags.push(...parsed.redFlags)
        allRxOptions.push(...parsed.rxOptions)
      }
    }
    symptoms = allSymptoms
    redFlags = allRedFlags
    rxOptions = allRxOptions
  } else {
    const parsed = parseSimpleCard(lines)
    symptoms = parsed.symptoms
    redFlags = parsed.redFlags
    rxOptions = parsed.rxOptions
  }

  const nonRxContent = findSectionContent(lines, "non-rx", ["follow-up", "follow up"])
  const nonRx = extractListItems(nonRxContent)

  const followUpContent = findSectionContent(lines, "follow-up", [])
  const followUpLines = extractListItems(followUpContent)
  const followUp = followUpLines.join(" ")

  return { id, name, slug, symptoms, redFlags, rxOptions, nonRx, followUp }
}

export function parseAilments(sourceDir: string): Ailment[] {
  const files = fs
    .readdirSync(sourceDir)
    .filter(f => /^\d{2}-/.test(f) && f.endsWith(".md"))
    .sort()

  const ailments: Ailment[] = files.map(file => {
    const content = fs.readFileSync(path.join(sourceDir, file), "utf-8")
    const match = file.match(/^(\d{2})-(.+)\.md$/)!
    const id = match[1]
    const slug = match[2]
    return parseAilmentFile(content, file, id, slug)
  })

  return ailments
}
