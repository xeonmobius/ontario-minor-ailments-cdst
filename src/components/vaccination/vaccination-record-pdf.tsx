"use client"

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer"
import type {
  AdministrationRoute,
  AdministrationSite,
  CaptureMethod,
  PatientInfo,
  PharmacyDefaults,
  SignerRelationship,
  VaccinationAdministration,
  VaccinationOutcome,
  WithholdReason,
} from "@/types"
import type { VaccineProduct } from "@/lib/vaccines/catalog"
import { getWithholdReasonOption } from "@/lib/vaccines/withhold-reasons"

const TEAL = "#1a6b6b"
const TEAL_LIGHT = "#e6f2f2"
const DARK = "#1a1a1a"
const MUTED = "#555555"
const BORDER = "#cccccc"
const GREEN = "#2d7d3f"
const GREEN_LIGHT = "#edf7ed"
const AMBER = "#8a5a00"

const ROUTE_LABEL: Record<AdministrationRoute, string> = {
  IM: "Intramuscular (IM)",
  SC: "Subcutaneous (SC)",
  ID: "Intradermal (ID)",
  intranasal: "Intranasal",
  oral: "Oral",
}

const SITE_LABEL: Record<AdministrationSite, string> = {
  left_deltoid: "Left deltoid",
  right_deltoid: "Right deltoid",
  left_vastus_lateralis: "Left vastus lateralis",
  right_vastus_lateralis: "Right vastus lateralis",
  left_arm: "Left arm",
  right_arm: "Right arm",
  nasal: "Nasal",
  oral: "Oral",
  other: "Other",
}

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
  greenBlock: {
    backgroundColor: GREEN_LIGHT,
    padding: 3,
    borderRadius: 2,
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
  amberBlock: {
    backgroundColor: "#fff7e6",
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
  patientSignatureBox: { flex: 1 },
  patientSignatureImage: { width: 130, height: 32, objectFit: "contain" },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: DARK,
    marginBottom: 2,
    height: 20,
  },
  signatureLabel: { fontSize: 6, color: MUTED, fontFamily: "Helvetica-Bold" },
  consentAttestation: { fontSize: 5.5, color: MUTED, marginTop: 2 },
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

interface VaccinationRecordPdfProps {
  vaccine: VaccineProduct
  patient: PatientInfo
  outcome: VaccinationOutcome
  administration: VaccinationAdministration | null
  withholdReason?: WithholdReason
  withholdNote?: string
  contraindicationsChecked: string[]
  consentSignatureDataUrl?: string | null
  consentSignerName?: string
  consentSignerRelationship?: SignerRelationship
  consentCaptureMethod?: CaptureMethod
  consentStatementVersion?: string
  consentCapturedAt?: string
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
  protocolVersion?: string
}

export function VaccinationRecordPdf({
  vaccine,
  patient,
  outcome,
  administration,
  withholdReason,
  withholdNote,
  contraindicationsChecked,
  consentSignatureDataUrl,
  consentSignerName,
  consentSignerRelationship,
  consentCaptureMethod,
  consentStatementVersion,
  consentCapturedAt,
  dateOfAssessment,
  pharmacy,
  protocolVersion,
}: VaccinationRecordPdfProps) {
  const administered = outcome === "administered"
  const withholdOption = getWithholdReasonOption(withholdReason ?? null)
  const nextDue = administered && administration
    ? administration.doseNumber < administration.seriesTotal
      ? `Dose ${administration.doseNumber + 1} of ${administration.seriesTotal} — contact patient to schedule.`
      : "Series complete."
    : null

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {administered ? "VACCINATION ADMINISTRATION RECORD" : "VACCINATION NOT ADMINISTERED — RECORD"}
            </Text>
            <Text style={styles.subtitle}>{vaccine.name} — Pharmacist Injecting Agent</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.confidentialBadge}>CONFIDENTIAL</Text>
            <Text style={styles.dateText}>{dateOfAssessment}</Text>
            {protocolVersion && (
              <Text style={styles.dateText}>Protocol: {protocolVersion.slice(0, 8)}</Text>
            )}
          </View>
        </View>

        <View style={styles.divider} />

        <Text style={styles.ailmentBanner}>{vaccine.name}</Text>

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
            {patient.sex && <View style={styles.fieldRow}><Text style={styles.label}>Sex</Text><Text style={styles.value}>{patient.sex}</Text></View>}
            {patient.phone && <View style={styles.fieldRow}><Text style={styles.label}>Phone</Text><Text style={styles.value}>{patient.phone}</Text></View>}
            {patient.address && <View style={styles.fieldRow}><Text style={styles.label}>Address</Text><Text style={styles.value}>{patient.address}, {patient.city} {patient.postalCode}</Text></View>}
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionLabel}>{administered ? "Administration" : "Outcome"}</Text>
            {administered && administration ? (
              <>
                <View style={styles.fieldRow}><Text style={styles.label}>Vaccine</Text><Text style={styles.value}>{administration.vaccineName}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Dose</Text><Text style={styles.value}>{administration.doseNumber} of {administration.seriesTotal}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Lot</Text><Text style={styles.value}>{administration.lotNumber}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Expiry</Text><Text style={styles.value}>{administration.expiryDate}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Mfr</Text><Text style={styles.value}>{administration.manufacturer || "—"}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Route</Text><Text style={styles.value}>{ROUTE_LABEL[administration.route]}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Site</Text><Text style={styles.value}>{SITE_LABEL[administration.site]}</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Volume</Text><Text style={styles.value}>{administration.doseVolume}</Text></View>
              </>
            ) : (
              <>
                <View style={styles.fieldRow}><Text style={styles.label}>Outcome</Text><Text style={styles.value}>Not administered</Text></View>
                <View style={styles.fieldRow}><Text style={styles.label}>Reason</Text><Text style={styles.value}>{withholdOption?.label ?? withholdReason ?? "—"}</Text></View>
              </>
            )}
            <View style={styles.fieldRow}><Text style={styles.label}>Pharmacist</Text><Text style={styles.value}>{pharmacy?.pharmacistName || "—"}</Text></View>
            <View style={styles.fieldRow}><Text style={styles.label}>Encounter</Text><Text style={styles.value}>{patient.encounterType || "—"}</Text></View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Contraindications Screened</Text>
        {contraindicationsChecked.length > 0 ? (
          <View style={styles.amberBlock}>
            {contraindicationsChecked.map((c) => (
              <View key={c} style={styles.checkItem}>
                <Text style={[styles.bullet, { color: AMBER }]}>!</Text>
                <Text style={styles.bulletText}>{c}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.greenBlock}>
            <View style={styles.checkItem}>
              <Text style={[styles.bullet, { color: GREEN }]}>✓</Text>
              <Text style={styles.bulletText}>None identified. Confirmed against the patient&apos;s record in the pharmacy management system.</Text>
            </View>
          </View>
        )}

        {administered && vaccine.patientEducation.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Patient Education Provided</Text>
            <View style={styles.greenBlock}>
              {vaccine.patientEducation.map((item) => (
                <View key={item} style={styles.checkItem}>
                  <Text style={[styles.bullet, { color: GREEN }]}>✓</Text>
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {nextDue && (
          <View style={styles.notesBlock}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>FOLLOW-UP</Text>
            <Text style={{ fontSize: 7 }}>{nextDue}</Text>
          </View>
        )}

        {withholdNote && (
          <View style={styles.notesBlock}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>NOTES</Text>
            <Text style={{ fontSize: 7 }}>{withholdNote}</Text>
          </View>
        )}

        {administration?.administrationNotes && (
          <View style={styles.notesBlock}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 6.5, marginBottom: 1, color: TEAL }}>ADMINISTRATION NOTES</Text>
            <Text style={{ fontSize: 7 }}>{administration.administrationNotes}</Text>
          </View>
        )}

        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>Pharmacist Signature</Text>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>{pharmacy?.pharmacistName || "__________"} — License #{pharmacy?.provincialLicense || "__________"}</Text>
          </View>
          <View style={styles.patientSignatureBox}>
            <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: TEAL, marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>
              Patient / SDM Signature{consentSignerRelationship && consentSignerRelationship !== "self" ? ` (${consentSignerRelationship})` : ""}
            </Text>
            {consentSignatureDataUrl ? (
              // react-pdf Image is a PDF primitive (not a DOM img) and has no alt prop.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={consentSignatureDataUrl} style={styles.patientSignatureImage} />
            ) : (
              <View style={styles.signatureLine} />
            )}
            <Text style={styles.signatureLabel}>{consentSignerName || "__________"}</Text>
          </View>
        </View>

        <View style={styles.footerDivider} />
        <View style={styles.phipaBox}>
          <Text>
            CONFIDENTIAL — Privileged health information under PHIPA. Vaccine administered by a pharmacist under the Ontario pharmacist injecting-agent authority. Report this administration to COVaxON / your local public health unit. Allergy, drug-interaction, and pregnancy/lactation screening are performed in the pharmacy management system and are not duplicated by this record.
          </Text>
          {consentCaptureMethod && (
            <Text style={styles.consentAttestation}>
              Patient/SDM consent captured {consentCaptureMethod === "verbal_attested" ? "verbally" : "in-person"}
              {consentCapturedAt ? ` on ${consentCapturedAt.slice(0, 10)}` : ""}
              {consentStatementVersion ? ` — statement version ${consentStatementVersion}` : ""}.
              {consentSignerName ? ` Signer: ${consentSignerName}` : ""}
              {consentSignerRelationship ? ` (${consentSignerRelationship})` : ""}.
            </Text>
          )}
        </View>
        <Text style={styles.footerText}>Vaccination Administration Record — Ontario pharmacist injecting-agent authority</Text>
      </Page>
    </Document>
  )
}
