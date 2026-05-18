"use client"

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer"
import { Ailment, PatientInfo, SelectedRx } from "@/types"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica" },
  header: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subheader: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  label: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  row: { flexDirection: "row", marginBottom: 4 },
  section: { marginBottom: 12 },
  table: { borderWidth: 1, borderColor: "#000" },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: "#000" },
  tableCell: { flex: 1, padding: 4, borderRightWidth: 1, borderColor: "#000" },
  tableCellLast: { flex: 1, padding: 4 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 8, color: "#666" },
})

interface PrescriptionPdfProps {
  ailment: Ailment
  patient: PatientInfo
  selectedRx: SelectedRx
  assessmentNotes: string
  dateOfAssessment: string
}

export function PrescriptionPdf({
  ailment,
  patient,
  selectedRx,
  assessmentNotes,
  dateOfAssessment,
}: PrescriptionPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.header}>PRESCRIPTION</Text>
        <Text style={{ marginBottom: 4 }}>
          {ailment.name} — O. Reg. 256/24
        </Text>
        <Text style={{ fontSize: 9, color: "#666", marginBottom: 12 }}>
          Date: {dateOfAssessment}
        </Text>

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
          {patient.address && (
            <View style={styles.row}>
              <Text><Text style={styles.label}>Address: </Text>{patient.address}, {patient.city} {patient.postalCode}</Text>
            </View>
          )}
          {patient.phone && (
            <View style={styles.row}>
              <Text><Text style={styles.label}>Phone: </Text>{patient.phone}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.subheader}>Prescription</Text>
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
              <View style={styles.tableCell}>
                <Text style={styles.label}>Qty</Text>
              </View>
              <View style={styles.tableCellLast}>
                <Text style={styles.label}>Refills</Text>
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
              <View style={styles.tableCell}>
                <Text>{selectedRx.quantity}</Text>
              </View>
              <View style={styles.tableCellLast}>
                <Text>{selectedRx.refills}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text><Text style={styles.label}>Allergies: </Text>{patient.allergies}</Text>
        </View>

        {assessmentNotes && (
          <View style={styles.section}>
            <Text style={styles.subheader}>Assessment Notes</Text>
            <Text>{assessmentNotes}</Text>
          </View>
        )}

        {selectedRx.duration && (
          <View style={styles.section}>
            <Text><Text style={styles.label}>Duration: </Text>{selectedRx.duration}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text><Text style={styles.label}>Follow-up: </Text>{ailment.followUp}</Text>
        </View>

        <View style={styles.footer}>
          <Text>Ontario Minor Ailments — O. Reg. 256/24 under the Pharmacy Act</Text>
        </View>
      </Page>
    </Document>
  )
}
