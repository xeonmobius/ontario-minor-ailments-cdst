"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import { Ailment, PatientInfo, PharmacyDefaults, SelectedRx } from "@/types"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  header: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2, textAlign: "center" },
  confidential: { fontSize: 10, textAlign: "center", marginBottom: 16, color: "#666" },
  subheader: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  row: { flexDirection: "row", marginBottom: 4 },
  section: { marginBottom: 12 },
  table: { borderWidth: 1, borderColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  tableCell: { flex: 1, padding: 4, borderRightWidth: 1, borderColor: "#000" },
  tableCellLast: { flex: 1, padding: 4 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#666" },
  hipaa: { fontSize: 8, color: "#999", marginTop: 16, padding: 8, borderWidth: 1, borderColor: "#ccc" },
})

interface NotificationPdfProps {
  ailment: Ailment
  patient: PatientInfo
  selectedRx: SelectedRx
  assessmentNotes: string
  dateOfAssessment: string
  pharmacy: PharmacyDefaults | null
}

export function NotificationPdf({
  ailment,
  patient,
  selectedRx,
  assessmentNotes,
  dateOfAssessment,
  pharmacy,
}: NotificationPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.header}>CONFIDENTIAL — FAX TRANSMISSION</Text>
        <Text style={styles.confidential}>Physician Notification — Minor Ailment Prescribing</Text>

        {pharmacy && (
          <View style={styles.section}>
            <Text style={styles.subheader}>From (Pharmacy)</Text>
            <Text>{pharmacy.pharmacyName}</Text>
            <Text>{pharmacy.address}, {pharmacy.city}, {pharmacy.province} {pharmacy.postalCode}</Text>
            <Text>Phone: {pharmacy.phone} | Fax: {pharmacy.fax}</Text>
            <Text>Pharmacist: {pharmacy.pharmacistName} ({pharmacy.ocpLicense})</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.subheader}>Patient Information</Text>
          <View style={styles.row}>
            <Text><Text style={styles.label}>Name: </Text>{patient.name}</Text>
          </View>
          <View style={styles.row}>
            <Text><Text style={styles.label}>DOB: </Text>{patient.dob}</Text>
          </View>
          {patient.ohip && (
            <View style={styles.row}>
              <Text><Text style={styles.label}>OHIP: </Text>{patient.ohip}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.subheader}>Assessment Details</Text>
          <View style={styles.row}>
            <Text><Text style={styles.label}>Ailment: </Text>{ailment.name}</Text>
          </View>
          <View style={styles.row}>
            <Text><Text style={styles.label}>Date: </Text>{dateOfAssessment}</Text>
          </View>
          <View style={styles.row}>
            <Text><Text style={styles.label}>Red flags ruled out: </Text>Yes</Text>
          </View>
          {assessmentNotes && (
            <View style={styles.row}>
              <Text><Text style={styles.label}>Notes: </Text>{assessmentNotes}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.subheader}>Medication Prescribed</Text>
          <View style={styles.table}>
            <View style={styles.tableRow}>
              <View style={styles.tableCell}>
                <Text style={styles.label}>Drug</Text>
              </View>
              <View style={styles.tableCell}>
                <Text style={styles.label}>Dose</Text>
              </View>
              <View style={styles.tableCell}>
                <Text style={styles.label}>Directions</Text>
              </View>
              <View style={styles.tableCellLast}>
                <Text style={styles.label}>Duration</Text>
              </View>
            </View>
            <View style={styles.tableRow}>
              <View style={styles.tableCell}>
                <Text>{selectedRx.drug}</Text>
              </View>
              <View style={styles.tableCell}>
                <Text>{selectedRx.dose}</Text>
              </View>
              <View style={styles.tableCell}>
                <Text>{selectedRx.sig}</Text>
              </View>
              <View style={styles.tableCellLast}>
                <Text>{selectedRx.duration}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text><Text style={styles.label}>Allergies: </Text>{patient.allergies}</Text>
          {patient.currentMeds && (
            <Text><Text style={styles.label}>Current Medications: </Text>{patient.currentMeds}</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text><Text style={styles.label}>Follow-up: </Text>{ailment.followUp}</Text>
        </View>

        <View style={styles.hipaa}>
          <Text>
            CONFIDENTIAL — This fax transmission contains information that is privileged and
            confidential. It is intended only for the use of the addressee. If you are not the
            intended recipient, you are hereby notified that any dissemination, distribution, or
            copying of this communication is strictly prohibited. This transmission is protected
            under the Personal Health Information Protection Act (PHIPA).
          </Text>
        </View>

        <View style={styles.footer}>
          <Text>Ontario Minor Ailments — O. Reg. 256/24 under the Pharmacy Act</Text>
        </View>
      </Page>
    </Document>
  )
}
