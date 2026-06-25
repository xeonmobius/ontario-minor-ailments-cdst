"use client"

import { Text, View, StyleSheet } from "@react-pdf/renderer"
import {
  CITATIONS_HASH,
  CITATIONS_VERSION,
  getCitations,
} from "@/lib/clinical/citations"

const styles = StyleSheet.create({
  refsLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: "#1a6b6b",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 3,
    marginBottom: 1,
  },
  refItem: {
    flexDirection: "row",
    marginBottom: 0.5,
  },
  refNum: {
    width: 10,
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: "#555555",
  },
  refText: {
    fontSize: 6,
    color: "#555555",
    flex: 1,
  },
})

export function ReferencesSection({ slug }: { slug: string }) {
  const citations = getCitations(slug)
  if (citations.length === 0) return null
  const hash8 = CITATIONS_HASH.slice(0, 8)

  return (
    <View>
      <Text style={styles.refsLabel}>
        References ({CITATIONS_VERSION} · {hash8})
      </Text>
      {citations.map((c, i) => (
        <View key={c.id} style={styles.refItem} wrap={false}>
          <Text style={styles.refNum}>{i + 1}.</Text>
          <Text style={styles.refText}>
            {c.source}
            {c.year ? ` (${c.year})` : ""}
            {c.doi ? ` · doi:${c.doi}` : c.url ? ` · ${c.url}` : ""} [{c.type}]
          </Text>
        </View>
      ))}
    </View>
  )
}
