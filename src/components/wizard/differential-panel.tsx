"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, ExternalLink, GitCompare } from "lucide-react"
import { DIFFERENTIALS } from "@/lib/clinical/differentials"
import { DifferentialDisposition } from "@/types"
import { cn } from "@/lib/utils"

export function DifferentialPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false)
  const entry = DIFFERENTIALS[slug]

  if (!entry || (entry.differentials.length === 0 && entry.dermnetLinks.length === 0)) {
    return null
  }

  const hasRefer = entry.differentials.some((d) => d.disposition === "refer")
  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="differential-panel-body"
        className="flex w-full items-center justify-between p-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-primary" aria-hidden="true" />
          Differentials to consider
          {hasRefer && (
            <span className="text-xs font-normal text-amber-600">
              • some require referral
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {open ? "Hide" : "Show"}
          <Chevron className="h-4 w-4" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div
          id="differential-panel-body"
          className="flex flex-col gap-3 border-t px-3 pb-3"
        >
          {entry.differentials.length > 0 && (
            <ul className="flex flex-col gap-1.5 pt-3">
              {entry.differentials.map((d) => (
                <li key={d.name} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.name}</span>
                    <DispositionTag disposition={d.disposition} />
                  </span>
                  <span className="pl-1 text-xs text-muted-foreground">
                    {d.distinguishingFeatures}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {entry.clinicalPearls?.map((p) => (
            <p key={p} className="text-xs italic text-muted-foreground">
              • {p}
            </p>
          ))}

          {entry.dermnetLinks.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Clinical images — DermNet NZ
              </span>
              <div className="flex flex-wrap gap-2">
                {entry.dermnetLinks.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DispositionTag({ disposition }: { disposition: DifferentialDisposition }) {
  const styles: Record<DifferentialDisposition, { label: string; className: string }> = {
    treat_in_tool: {
      label: "Also assess",
      className: "border-border bg-muted text-muted-foreground",
    },
    refer: {
      label: "Refer if suspected",
      className: "border-amber-400/60 bg-amber-50 text-amber-700",
    },
    otc_only: {
      label: "Self-care",
      className: "border-border bg-transparent text-muted-foreground",
    },
  }
  const { label, className } = styles[disposition]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      {label}
    </span>
  )
}
