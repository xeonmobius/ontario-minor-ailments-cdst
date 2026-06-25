"use client"

import { useEffect, useRef } from "react"
// react-signature-canvas is a class component that forwards SignaturePad's
// instance methods (clear/isEmpty/toDataURL/getSignaturePad) onto its ref.
// signature_pad (its peer) touches window/document, so the importing component
// MUST load this module via next/dynamic({ ssr: false }) — see consent-panel.tsx.
import SignatureCanvas from "react-signature-canvas"
import { Button } from "@/components/ui/button"

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void
  ariaLabel?: string
}

export function SignaturePad({ onChange, ariaLabel }: SignaturePadProps) {
  const padRef = useRef<SignatureCanvas | null>(null)
  // Keep the latest onChange in a ref so the endStroke listener (bound once on
  // mount) always calls the freshest callback without re-subscribing.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  function emit() {
    const pad = padRef.current
    if (!pad) return
    // isEmpty() is the validity check: a zero-point canvas is not a signature.
    onChangeRef.current(pad.isEmpty() ? null : pad.toDataURL("image/png"))
  }

  useEffect(() => {
    const pad = padRef.current?.getSignaturePad()
    if (!pad) return
    // signature_pad 5.x replaced the v4 onEnd option with an endStroke event.
    const handler = () => emit()
    pad.addEventListener("endStroke", handler)
    return () => pad.removeEventListener("endStroke", handler)
    // emit is stable; bind once on mount.
  }, [])

  function handleClear() {
    padRef.current?.clear()
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative rounded-lg border border-dashed border-input bg-background p-1"
        aria-label={ariaLabel ?? "Signature pad"}
        role="img"
      >
        <SignatureCanvas
          ref={(el) => {
            padRef.current = el
          }}
          canvasProps={{
            width: 500,
            height: 140,
            className: "w-full h-auto touch-none",
            "aria-label": ariaLabel ?? "Signature pad",
          }}
          clearOnResize={false}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Sign above with a finger or stylus.</p>
        <Button type="button" variant="outline" size="sm" onClick={handleClear}>
          Clear
        </Button>
      </div>
    </div>
  )
}
