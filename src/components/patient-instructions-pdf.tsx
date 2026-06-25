"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import type { Ailment, PharmacyDefaults, SelectedRx } from "@/types"
import { filterCheckedItems } from "@/lib/pdf-filter"
import {
  getFrDirections,
  getPatientInstructions,
  PATIENT_INSTRUCTIONS_HASH,
  PATIENT_INSTRUCTIONS_VERSION,
  SAFETY_NET_EN,
  SAFETY_NET_FR,
  SIG_FALLBACK_NOTE_FR,
  type Language,
} from "@/lib/i18n/patient-instructions"

// A patient handout, NOT a clinical record: larger type, patient-friendly
// register, no PHIPA footer, no prescriber signature, no patient name (PHI
// minimisation — spec §4.2/§6 case 9). Ships live in Phase 1 as non-PHI
// reference content + a client-rendered PDF (spec §5.1).

const TEAL = "#1a6b6b"
const DARK = "#1a1a1a"
const MUTED = "#555555"

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10.5,
    fontFamily: "Helvetica",
    color: DARK,
    lineHeight: 1.45,
  },
  title: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    marginBottom: 2,
  },
  ailmentName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: DARK,
    marginBottom: 1,
  },
  meta: { fontSize: 9, color: MUTED, marginBottom: 12 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    marginTop: 10,
    marginBottom: 3,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  drug: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  directions: { fontSize: 10.5, marginBottom: 2 },
  note: { fontSize: 9, color: MUTED, fontStyle: "italic", marginBottom: 2 },
  listItem: {
    flexDirection: "row",
    marginBottom: 2,
  },
  bullet: { width: 14, fontSize: 10.5 },
  itemText: { flex: 1, fontSize: 10.5 },
  followUp: { fontSize: 10.5, marginBottom: 2 },
  footer: {
    marginTop: 16,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#cccccc",
    fontSize: 9,
    color: MUTED,
  },
  corpus: { fontSize: 7, color: MUTED, marginTop: 6 },
})

interface PatientInstructionsPdfProps {
  ailment: Ailment
  selectedRx: SelectedRx
  nonRxChecked: string[]
  pharmacy: PharmacyDefaults | null
  // "en" → EN page, "fr" → FR page, "both" → EN then FR in one Document.
  language: Language | "both"
  dateOfAssessment: string
}

// Resolves the FR index for a checked EN self-care string by matching it
// positionally against ailment.nonRx (spec §4.1). Returns undefined on a miss,
// in which case the caller falls back to the EN string (graceful degradation).
function resolveFrSelfCare(
  ailment: Ailment,
  checkedEn: string,
  fr: ReturnType<typeof getPatientInstructions>,
): string | undefined {
  const idx = ailment.nonRx.indexOf(checkedEn)
  if (idx === -1 || !fr) return undefined
  return fr.nonRxFr[idx]
}

// Sig-translation invariant (spec §4.3). The FR directions are EITHER the
// canonical human-authored FR block for this regimen (when one exists AND the
// pharmacist's typed sig still matches the regimen's standard seed) OR the
// pharmacist's EN selectedRx.sig verbatim with a FR "ask your pharmacist"
// note. There is no on-the-fly conversion path; directions are pre-authored
// human FR or the pharmacist's own wording, verbatim.
function resolveFrDirections(
  slug: string,
  selectedRx: SelectedRx,
): { text: string; isCanonical: boolean } {
  const canonicalFr = getFrDirections(slug, selectedRx.drug)
  if (canonicalFr && selectedRx.sig === selectedRx.dose) {
    return { text: canonicalFr, isCanonical: true }
  }
  return { text: selectedRx.sig, isCanonical: false }
}

interface PageContent {
  langLabel: "EN" | "FR"
  ailmentHeading: string
  drugHeading: string
  directionsHeading: string
  directionsText: string
  directionsNote?: string
  selfCareHeading: string
  selfCareItems: string[]
  followUpHeading: string
  followUpText: string
  seekHelpHeading: string
  seekHelpText: string
  pharmacyLine: string
  questionsLine: string
}

function buildEnPage(
  props: PatientInstructionsPdfProps,
): PageContent {
  const checkedNonRx = filterCheckedItems(props.ailment.nonRx, props.nonRxChecked)
  return {
    langLabel: "EN",
    ailmentHeading: props.ailment.name,
    drugHeading: "Your medication",
    directionsHeading: "Directions",
    directionsText: props.selectedRx.sig,
    selfCareHeading: "How to care for yourself",
    selfCareItems: checkedNonRx,
    followUpHeading: "When to come back",
    followUpText: props.ailment.followUp,
    seekHelpHeading: "When to seek help",
    seekHelpText: SAFETY_NET_EN,
    pharmacyLine: props.pharmacy?.pharmacyName ?? "",
    questionsLine: "Questions? Ask your pharmacist.",
  }
}

function buildFrPage(
  props: PatientInstructionsPdfProps,
): PageContent {
  const fr = getPatientInstructions(props.ailment.slug, "fr")
  // If the ailment is un-curated, fall back to EN content so the component
  // never throws when called directly (spec §6 case 1; the generate-step UI
  // disables FR for un-curated ailments, but this keeps the PDF robust).
  if (!fr) return buildEnPage(props)

  const checkedNonRx = filterCheckedItems(props.ailment.nonRx, props.nonRxChecked)
  const selfCareItems = checkedNonRx.map(
    (item) => resolveFrSelfCare(props.ailment, item, fr) ?? item,
  )
  const directions = resolveFrDirections(props.ailment.slug, props.selectedRx)

  return {
    langLabel: "FR",
    ailmentHeading: props.ailment.name,
    drugHeading: "Votre médicament",
    directionsHeading: "Directives",
    directionsText: directions.text,
    directionsNote: directions.isCanonical ? undefined : SIG_FALLBACK_NOTE_FR,
    selfCareHeading: "Soins à domicile",
    selfCareItems,
    followUpHeading: "Quand consulter à nouveau",
    followUpText: fr.followUpFr,
    seekHelpHeading: "Quand consulter un médecin",
    seekHelpText: SAFETY_NET_FR,
    pharmacyLine: props.pharmacy?.pharmacyName ?? "",
    questionsLine: "Questions? Adressez-vous à votre pharmacien.",
  }
}

function HandoutPage({
  content,
  dateOfAssessment,
  versionTag,
}: {
  content: PageContent
  dateOfAssessment: string
  versionTag: string
}) {
  return (
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.title}>Patient Instructions</Text>
      <Text style={styles.ailmentName}>
        {content.ailmentHeading}{" "}
        ({content.langLabel})
      </Text>
      <Text style={styles.meta}>{dateOfAssessment}</Text>

      <Text style={styles.sectionHeader}>{content.drugHeading}</Text>
      <Text style={styles.directions}>{content.directionsText}</Text>
      {content.directionsNote ? (
        <Text style={styles.note}>{content.directionsNote}</Text>
      ) : null}

      {content.selfCareItems.length > 0 ? (
        <>
          <Text style={styles.sectionHeader}>{content.selfCareHeading}</Text>
          {content.selfCareItems.map((item, i) => (
            <View key={`${content.langLabel}-care-${i}`} style={styles.listItem} wrap={false}>
              <Text style={styles.bullet}>✓</Text>
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.sectionHeader}>{content.followUpHeading}</Text>
      <Text style={styles.followUp}>{content.followUpText}</Text>

      <Text style={styles.sectionHeader}>{content.seekHelpHeading}</Text>
      <Text style={styles.followUp}>{content.seekHelpText}</Text>

      <View style={styles.footer} wrap={false}>
        {content.pharmacyLine ? (
          <Text>{content.pharmacyLine}</Text>
        ) : null}
        <Text>{content.questionsLine}</Text>
        <Text style={styles.corpus}>{versionTag}</Text>
      </View>
    </Page>
  )
}

export function PatientInstructionsPdf(props: PatientInstructionsPdfProps) {
  const hash8 = PATIENT_INSTRUCTIONS_HASH.slice(0, 8)
  const versionTag = `${PATIENT_INSTRUCTIONS_VERSION} · ${hash8}`
  const pages: PageContent[] =
    props.language === "both"
      ? [buildEnPage(props), buildFrPage(props)]
      : props.language === "fr"
        ? [buildFrPage(props)]
        : [buildEnPage(props)]

  return (
    <Document>
      {pages.map((content, i) => (
        <HandoutPage
          key={`${content.langLabel}-${i}`}
          content={content}
          dateOfAssessment={props.dateOfAssessment}
          versionTag={versionTag}
        />
      ))}
    </Document>
  )
}
