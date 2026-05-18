import { Ailment } from "@/types"
import Link from "next/link"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"

export function AilmentCard({ ailment }: { ailment: Ailment }) {
  const preview = ailment.symptoms.slice(0, 3).join(", ")
  return (
    <Link href={`/assess/${ailment.slug}`}>
      <Card>
        <CardHeader>
          <CardTitle>{ailment.name}</CardTitle>
          <CardDescription>{preview}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  )
}
