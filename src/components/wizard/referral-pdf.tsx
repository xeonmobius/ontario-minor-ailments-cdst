"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import { Ailment, PatientInfo, PharmacyDefaults } from "@/types"
import { ReferencesSection } from "./pdf-references"

const TEAL = "#1a6b6b"
const TEAL_LIGHT = "#e6f2f2"
const RED = "#b91c1c"
const RED_LIGHT = "#fef2f2"
const DARK = "#1a1a1a"
const MUTED = "#555555"
const BORDER = "#cccccc"

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
    color: RED,
    letterSpacing: 1.5,
  },
  subtitle: { fontSize: 7, color: MUTED, marginTop: 1 },
  ailmentBanner: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    backgroundColor: RED,
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
    color: RED,
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  dateText: { fontSize: 7, color: MUTED, marginTop: 2, textAlign: "right" },
  divider: {
    borderBottomWidth: 1.5,
    borderBottomColor: RED,
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
    color: RED,
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
  redFlagItem: {
    flexDirection: "row",
    marginBottom: 1,
  },
  redBullet: { width: 10, fontSize: 7, fontFamily: "Helvetica-Bold", color: RED },
  redBulletText: { fontSize: 7, flex: 1 },
  redBlock: {
    backgroundColor: RED_LIGHT,
    padding: 3,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: "#fca5a5",
    marginBottom: 3,
  },
  notesBlock: {
    backgroundColor: "#f9f9f9",
    padding: 3,
    borderRadius: 2,
    borderWidth: 0.5,
    borderColor: "#eeeeee",
    marginBottom: 3,
  },
  patientSectionLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
    marginTop: 3,
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

interface ReferralPdfProps {
  ailment: Ailment
  patient: PatientInfo
  redFlagsChecked: string[]
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
  referralContext?: "red_flag" | "non_red_flag"
  referralReason?: string
}

export function ReferralPdf({
  ailment,
  patient,
  redFlagsChecked,
  dateOfAssessment,
  pharmacy,
  referralContext = "red_flag",
  referralReason,
}: ReferralPdfProps) {
  const isNonRedFlag = referralContext === "non_red_flag"
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>REFERRAL</Text>
            <Text style={styles.subtitle}>{ailment.name} — O. Reg. 256/24</Text>
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
            <Text style={styles.patientSectionLabel}>Patient</Text>
            <View style={styles.fieldRow}><Text style={styles.label}>Name</Text><Text style={styles.value}>{patient.name}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>DOB</Text><Text style={styles.value}>{patient.dob}</Text></View>
            {patient.phone && <View style={styles.fieldRow}><Text style={styles.label}>Phone</Text><Text style={styles.value}>{patient.phone}</Text></View>}
            {patient.encounterType && <View style={styles.fieldRow}><Text style={styles.label}>Encounter</Text><Text style={styles.value}>{patient.encounterType}</Text></View>}
          </View>
          <View style={styles.col}>
            <Text style={styles.patientSectionLabel}>Family Physician</Text>
            {patient.doctorName ? (
              <>
                <View style={styles.fieldRow}><Text style={styles.label}>Dr.</Text><Text style={styles.value}>{patient.doctorName}</Text></View>
                {patient.doctorPhone && <View style={styles.fieldRow}><Text style={styles.label}>Phone</Text><Text style={styles.value}>{patient.doctorPhone}</Text></View>}
                {patient.doctorFax && <View style={styles.fieldRow}><Text style={styles.label}>Fax</Text><Text style={styles.value}>{patient.doctorFax}</Text></View>}
              </>
            ) : (
              <Text style={{ fontSize: 7, color: MUTED }}>No physician on file</Text>
            )}
          </View>
        </View>

        {isNonRedFlag ? (
          <>
            <Text style={styles.sectionLabel}>Reason for Referral</Text>
            <View style={styles.notesBlock}>
              <Text style={{ fontSize: 7 }}>
                {referralReason || "Pharmacist clinical judgment — physician review warranted (no red flags identified)."}
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionLabel}>Red Flags Identified</Text>
            <View style={styles.redBlock}>
              {redFlagsChecked.map((flag) => (
                <View key={flag} style={styles.redFlagItem}>
                  <Text style={styles.redBullet}>⚠</Text>
                  <Text style={styles.redBulletText}>{flag}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>Pharmacist Signature</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{pharmacy?.pharmacistName || "__________"} — License #{pharmacy?.provincialLicense || "__________"}</Text>
          </View>
        </View>

        <ReferencesSection slug={ailment.slug} />

        <View style={styles.footerDivider} />
        <View style={styles.phipaBox}>
          <Text>
            {isNonRedFlag
              ? "CONFIDENTIAL — Privileged health information under PHIPA. Patient referred for physician review per O. Reg. 256/24. Allergy, drug-interaction, and pregnancy/lactation screening are performed in the pharmacy management system and are not duplicated by this assessment."
              : "CONFIDENTIAL — Privileged health information under PHIPA. Patient referred to primary care physician due to identified red flags per O. Reg. 256/24. Allergy, drug-interaction, and pregnancy/lactation screening are performed in the pharmacy management system and are not duplicated by this assessment."}
          </Text>
        </View>
        <Text style={styles.footerText}>Ontario Minor Ailments CDST — O. Reg. 256/24 under the Pharmacy Act</Text>
      </Page>
    </Document>
  )
}
