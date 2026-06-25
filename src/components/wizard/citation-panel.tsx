"use client"

import { useState } from "react"
import { BookOpen, ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { CITATIONS } from "@/lib/clinical/citations"
import type { Citation, CitationType, ProtocolStep } from "@/types"
import { cn } from "@/lib/utils"

const TYPE_BADGE_STYLES: Record<CitationType, string> = {
  guideline: "border-border bg-muted text-muted-foreground",
  study: "border-border bg-muted text-muted-foreground",
  "systematic-review": "border-primary/30 bg-primary/5 text-primary",
  regulatory: "border-amber-400/60 bg-amber-50 text-amber-700",
  monograph: "border-border bg-transparent text-muted-foreground",
}

function citationHref(c: Citation): string | null {
  if (c.url) return c.url
  if (c.doi) return `https://doi.org/${c.doi}`
  return null
}

function dedupe(list: Citation[]): Citation[] {
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const c of list) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}

export function CitationPanel({
  slug,
  step,
}: {
  slug: string
  step: ProtocolStep
}) {
  const [open, setOpen] = useState(false)
  const entry = CITATIONS[slug]

  if (!entry) return null

  const list = dedupe([...entry.primary, ...(entry.byStep?.[step] ?? [])])
  const regulatory = entry.regulatory
  if (list.length === 0 && regulatory.length === 0) return null

  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`citation-panel-${slug}-${step}`}
        className="flex w-full items-center justify-between p-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
          Evidence
          {list.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({list.length})
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {open ? "Hide" : "Show sources"}
          <Chevron className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div
          id={`citation-panel-${slug}-${step}`}
          className="flex flex-col gap-2 border-t px-3 pb-3 pt-3"
        >
          {list.map((c) => (
            <CitationRow key={c.id} c={c} />
          ))}
          {regulatory.map((c) => (
            <CitationRow key={c.id} c={c} muted />
          ))}
        </div>
      )}
    </div>
  )
}

function CitationRow({ c, muted }: { c: Citation; muted?: boolean }) {
  const href = citationHref(c)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
            TYPE_BADGE_STYLES[c.type],
          )}
        >
          {c.type}
        </span>
        <span className={cn("text-xs", muted && "text-muted-foreground")}>
          {c.source}
          {c.year ? ` (${c.year})` : ""}
        </span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            source
          </a>
        )}
      </span>
      {c.summary && (
        <span className="pl-1 text-[11px] text-muted-foreground">{c.summary}</span>
      )}
    </div>
  )
}
