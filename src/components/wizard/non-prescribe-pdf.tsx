"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import { Ailment, NonPrescribeReason, PatientInfo, PharmacyDefaults } from "@/types"
import { filterCheckedItems } from "@/lib/pdf-filter"

const TEAL = "#1a6b6b"
const TEAL_LIGHT = "#e6f2f2"
const DARK = "#1a1a1a"
const MUTED = "#555555"
const BORDER = "#cccccc"
const GREEN = "#2d7d3f"
const GREEN_LIGHT = "#edf7ed"

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: DARK,
    lineHeight: 1.3,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 3,
  },
  title: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    letterSpacing: 1.5,
  },
  subtitle: { fontSize: 7, color: MUTED, marginTop: 1 },
  ailmentBanner: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    backgroundColor: TEAL,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    marginBottom: 4,
    marginTop: 2,
    alignSelf: "flex-start",
  },
  confidentialBadge: {
    fontSize: 6,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  dateText: { fontSize: 7, color: MUTED, marginTop: 2, textAlign: "right" },
  divider: {
    borderBottomWidth: 1.5,
    borderBottomColor: TEAL,
    marginVertical: 4,
  },
  pharmacyBlock: {
    backgroundColor: TEAL_LIGHT,
    padding: 4,
    borderRadius: 2,
    marginBottom: 4,
  },
  pharmacyName: { fontSize: 8, fontFamily: "Helvetica-Bold", color: TEAL },
  pharmacyDetail: { fontSize: 6.5, color: MUTED, marginTop: 1 },
  sectionLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
    marginTop: 3,
  },
  columns: { flexDirection: "row", gap: 12, marginBottom: 2 },
  col: { flex: 1 },
  fieldRow: { flexDirection: "row", marginBottom: 1 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 7.5, width: 52, color: DARK },
  value: { fontSize: 7.5, flex: 1 },
  checkItem: { flexDirection: "row", marginBottom: 1 },
  bullet: { width: 10, fontSize: 7, fontFamily: "Helvetica-Bold" },
  bulletText: { fontSize: 7, flex: 1 },
  reasonBlock: {
    backgroundColor: GREEN_LIGHT,
    padding: 3,
    borderRadius: 2,
    marginBottom: 3,
  },
  reasonLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: GREEN },
  notesBlock: {
    backgroundColor: "#f9f9f9",
    padding: 3,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: "#eeeeee",
    marginBottom: 3,
  },
  greenBlock: {
    backgroundColor: GREEN_LIGHT,
    padding: 3,
    borderRadius: 2,
    marginBottom: 3,
  },
  signatureSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  signatureBox: { flex: 1, marginRight: 12 },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: DARK,
    marginBottom: 2,
    height: 20,
  },
  signatureLabel: { fontSize: 6, color: MUTED, fontFamily: "Helvetica-Bold" },
  footerDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    marginTop: 4,
    marginBottom: 2,
  },
  phipaBox: {
    fontSize: 5,
    color: MUTED,
    padding: 2,
    borderWidth: 0.5,
    borderColor: BORDER,
    borderRadius: 2,
  },
  footerText: { fontSize: 5, color: MUTED, textAlign: "center", marginTop: 2 },
})

interface NonPrescribePdfProps {
  ailment: Ailment
  patient: PatientInfo
  reason: NonPrescribeReason
  reasonLabel: string
  rationale: string
  nonRxChecked: string[]
  assessmentNotes: string
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
  consentSignerName?: string
  consentSignerRelationship?: string
  consentCaptureMethod?: string
  consentStatementVersion?: string
  consentCapturedAt?: string
}

export function NonPrescribePdf({
  ailment,
  patient,
  reasonLabel,
  rationale,
  nonRxChecked,
  assessmentNotes,
  dateOfAssessment,
  pharmacy,
  consentSignerName,
  consentSignerRelationship,
  consentCaptureMethod,
  consentStatementVersion,
  consentCapturedAt,
}: NonPrescribePdfProps) {
  const activeNonRx = filterCheckedItems(ailment.nonRx, nonRxChecked)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>ASSESSMENT RECORD</Text>
            <Text style={styles.subtitle}>
              {ailment.name} — NO PRESCRIPTION ISSUED — O. Reg. 256/24
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.confidentialBadge}>CONFIDENTIAL</Text>
            <Text style={styles.dateText}>{dateOfAssessment}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.ailmentBanner}>{ailment.name}</Text>

        {pharmacy && (
          <View style={styles.pharmacyBlock}>
            <Text style={styles.pharmacyName}>{pharmacy.pharmacyName || "Pharmacy Name"}</Text>
            <Text style={styles.pharmacyDetail}>
              {pharmacy.address}{pharmacy.city ? `, ${pharmacy.city}` : ""}, {pharmacy.province} {pharmacy.postalCode} | Ph: {pharmacy.phone || "—"} | Fax: {pharmacy.fax || "—"}
            </Text>
            <Text style={styles.pharmacyDetail}>
              {pharmacy.pharmacistName || "—"} | License: {pharmacy.provincialLicense || "—"} | Reg#: {pharmacy.registrationNumber || "—"}
            </Text>
          </View>
        )}

        <View style={styles.columns}>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Patient</Text>
            <View style={styles.fieldRow}><Text style={styles.label}>Name</Text><Text style={styles.value}>{patient.name}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>DOB</Text><Text style={styles.value}>{patient.dob}</Text></View>
            {patient.address && <View style={styles.fieldRow}><Text style={styles.label}>Address</Text><Text style={styles.value}>{patient.address}, {patient.city} {patient.postalCode}</Text></View>}
            {patient.phone && <View style={styles.fieldRow}><Text style={styles.label}>Phone</Text><Text style={styles.value}>{patient.phone}</Text></View>}
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>Assessment</Text>
            <View style={styles.fieldRow}><Text style={styles.label}>Ailment</Text><Text style={styles.value}>{ailment.name}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>Date</Text><Text style={styles.value}>{dateOfAssessment}</Text></View>
            {patient.encounterType && <View style={styles.fieldRow}><Text style={styles.label}>Encounter</Text><Text style={styles.value}>{patient.encounterType}</Text></View>}
            <View style={styles.fieldRow}><Text style={styles.label}>Outcome</Text><Text style={{ fontSize: 7.5, color: GREEN }}>No prescription issued</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>Red flags</Text><Text style={styles.value}>None identified</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>Follow-up</Text><Text style={styles.value}>{ailment.followUp}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Reason No Prescription Issued</Text>
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonLabel}>{reasonLabel}</Text>
        </View>
        {rationale && (
          <View style={styles.notesBlock}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>CLINICAL RATIONALE</Text>
            <Text style={{ fontSize: 7 }}>{rationale}</Text>
          </View>
        )}

        {activeNonRx.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Non-Prescription Advice Provided</Text>
            <View style={styles.greenBlock}>
              {activeNonRx.map((item) => (
                <View key={item} style={styles.checkItem}>
                  <Text style={[styles.bullet, { color: GREEN }]}>✓</Text>
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {assessmentNotes && (
          <View style={styles.notesBlock}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>ASSESSMENT NOTES</Text>
            <Text style={{ fontSize: 7 }}>{assessmentNotes}</Text>
          </View>
        )}

        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>Pharmacist Signature</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{pharmacy?.pharmacistName || "__________"} — License #{pharmacy?.provincialLicense || "__________"}</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>
              {consentSignerName ? "Patient / SDM Signature" : "Patient / SDM Signature"}
            </Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>
              {consentSignerName ? `${consentSignerName}${consentSignerRelationship ? ` (${consentSignerRelationship})` : ""}` : "__________"}
            </Text>
          </View>
        </View>

        <View style={styles.footerDivider} />
        <View style={styles.phipaBox}>
          <Text>
            CONFIDENTIAL — Privileged health information under PHIPA. Assessment completed; no prescription issued per O. Reg. 256/24. Reason recorded above. Allergy, drug-interaction, and pregnancy/lactation screening are performed in the pharmacy management system and are not duplicated by this assessment.
          </Text>
        </View>
        {consentCaptureMethod && (
          <Text style={styles.footerText}>
            Consent captured {consentCaptureMethod}
            {consentCapturedAt ? ` on ${consentCapturedAt}` : ""}
            {consentStatementVersion ? ` — statement version ${consentStatementVersion}` : ""}.
          </Text>
        )}
        <Text style={styles.footerText}>Ontario Minor Ailments CDST — O. Reg. 256/24 under the Pharmacy Act</Text>
      </Page>
    </Document>
  )
}
