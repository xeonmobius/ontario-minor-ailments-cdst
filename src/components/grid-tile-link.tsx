import Link from "next/link"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * The standard picker-grid tile: a full-height Card link with the shared
 * hover world (lift + shadow + primary border + primary title). Every
 * "choose an item" grid on a dashboard uses this — the ailment picker and
 * the vaccine picker are the same pattern and must move the same way.
 */
export function GridTileLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link href={href} className="group">
      <Card
        className={cn(
          "h-full transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {children}
      </Card>
    </Link>
  )
}
