"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import type { PharmacyMember } from "@/types"

export function PharmacyBadge({
  pharmacyName,
  pharmacyId,
  memberships,
}: {
  pharmacyName: string | null
  pharmacyId: string | null
  memberships: PharmacyMember[]
}) {
  const [open, setOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  if (memberships.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 text-primary text-sm font-medium">
        <Building2 className="size-4" />
        <span className="hidden sm:inline">{pharmacyName || "No pharmacy"}</span>
      </div>
    )
  }

  async function handleSwitch(targetId: string) {
    setLoading(true)
    await fetch("/api/auth/switch-pharmacy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pharmacyId: targetId }),
    })
    setOpen(false)
    setConfirmId(null)
    setLoading(false)
    router.refresh()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-primary border-primary/30"
        onClick={() => setOpen(true)}
      >
        <Building2 className="size-4" />
        <span className="hidden sm:inline max-w-[140px] truncate">{pharmacyName}</span>
        <ChevronDown className="size-3" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); setConfirmId(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch Pharmacy</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {memberships.map((m) => (
              <div key={m.pharmacyId}>
                {confirmId === m.pharmacyId ? (
                  <div className="flex items-center justify-between p-3 rounded-md border border-primary/30 bg-primary/5">
                    <span className="text-sm font-medium">{m.pharmacyName}</span>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={loading} onClick={() => handleSwitch(m.pharmacyId)}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      m.pharmacyId === pharmacyId
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => {
                      if (m.pharmacyId === pharmacyId) {
                        setOpen(false)
                        return
                      }
                      setConfirmId(m.pharmacyId)
                    }}
                  >
                    <span className="text-sm font-medium">{m.pharmacyName}</span>
                    {m.pharmacyId === pharmacyId && (
                      <span className="text-xs text-primary ml-2">(active)</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-2 capitalize">{m.role}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="w-full" />} />
            Cancel
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
