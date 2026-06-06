"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export function BackButton() {
  const router = useRouter()
  return (
    <Button variant="ghost" size="icon" onClick={() => router.back()} aria-label="Back">
      <ArrowLeft className="size-4" />
    </Button>
  )
}
