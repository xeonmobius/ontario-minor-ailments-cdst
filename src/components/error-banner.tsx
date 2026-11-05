/**
 * Standard inline error surface for form/action failures. `role="alert"` so
 * screen readers announce the failure immediately.
 */
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {children}
    </div>
  )
}
