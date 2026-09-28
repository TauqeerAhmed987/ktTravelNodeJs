import { Document, Page, Text, View, StyleSheet, Link, renderToBuffer } from '@react-pdf/renderer';

// Mirrors kt_travel_web/resources/views/pdf/invoice.blade.php section-for-section
// and color-for-color, since the guest-facing invoice must look the same
// whichever system produced it.
const GREEN = '#325440';
const GREEN_LIGHT_BG = '#f7f9f7';
const GREEN_LIGHT_BORDER = '#d0e0d4';
const ORANGE = '#f57c00';
const ORANGE_DARK = '#e65100';
const YELLOW_BG = '#fff8e1';
const YELLOW_BORDER = '#ffe082';
const BLUE = '#2980b9';
const BLUE_BG = '#e8f4fd';
const BLUE_BORDER = '#b3d7f0';
const CHANGE_GREEN = '#2d7a4f';
const CHANGE_BG = '#f0faf4';
const CHANGE_BORDER = '#a8d5b5';
const PAID_GREEN = '#2e7d32';
const GREY = '#666';
const GREY_LIGHT = '#888';
const TEXT = '#333';
const TEXT_DARK = '#1a1a1a';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, color: TEXT, fontFamily: 'Helvetica' },

  header: { borderBottom: `3pt solid ${GREEN}`, paddingBottom: 16, marginBottom: 22, flexDirection: 'row', justifyContent: 'space-between' },
  companyName: { fontSize: 20, fontWeight: 'bold', color: GREEN },
  companySub: { fontSize: 10, color: GREY_LIGHT, marginTop: 3 },
  invoiceLabel: { fontSize: 24, fontWeight: 'bold', color: GREEN, textAlign: 'right' },
  invoiceMeta: { fontSize: 10, color: GREY, marginTop: 6, textAlign: 'right', lineHeight: 1.5 },

  parties: { flexDirection: 'row', marginBottom: 22 },
  partyCol: { flex: 1, paddingRight: 16 },
  partyLabel: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: GREEN, marginBottom: 6, borderBottom: '1pt solid #e0e0e0', paddingBottom: 4 },
  partyName: { fontSize: 12, fontWeight: 'bold', color: TEXT_DARK, marginBottom: 3 },
  partyDetail: { fontSize: 10, color: GREY, lineHeight: 1.5 },

  sectionTitle: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: GREEN, marginBottom: 8 },
  eventBox: { backgroundColor: GREEN_LIGHT_BG, border: `1pt solid ${GREEN_LIGHT_BORDER}`, borderRadius: 4, padding: 12, marginBottom: 20 },
  eventRow: { flexDirection: 'row', marginTop: 6 },
  eventCell: { flex: 1 },
  eventFieldLabel: { fontSize: 9, color: GREY_LIGHT, textTransform: 'uppercase' },
  eventFieldValue: { fontSize: 11, color: TEXT, marginTop: 2, fontWeight: 'bold' },

  table: { marginBottom: 20 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: GREEN, paddingVertical: 6, paddingHorizontal: 8 },
  tableHeaderCell: { flex: 1, fontSize: 9, fontWeight: 'bold', color: '#fff' },
  tableRow: { flexDirection: 'row', borderBottom: '1pt solid #eee', paddingVertical: 6, paddingHorizontal: 8 },
  tableCell: { flex: 1, fontSize: 10, color: '#444' },
  right: { textAlign: 'right' },

  totalsWrap: { flexDirection: 'row', marginBottom: 20 },
  totalsSpacer: { flex: 1 },
  totalsBox: { flex: 1 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', borderBottom: '1pt solid #eee', paddingVertical: 5 },
  totalsLabel: { fontSize: 10, color: GREY },
  totalsValue: { fontSize: 10, color: TEXT, fontWeight: 'bold' },
  totalsGrandRow: { flexDirection: 'row', justifyContent: 'space-between', borderTop: `2pt solid ${GREEN}`, paddingTop: 8, marginTop: 4 },
  totalsGrandLabel: { fontSize: 11, color: GREEN, fontWeight: 'bold' },
  totalsGrandValue: { fontSize: 13, color: GREEN, fontWeight: 'bold' },
  totalsPaidLabel: { fontSize: 10, color: PAID_GREEN },
  totalsPaidValue: { fontSize: 10, color: PAID_GREEN, fontWeight: 'bold' },

  scheduleBox: { backgroundColor: YELLOW_BG, border: `1pt solid ${YELLOW_BORDER}`, borderRadius: 4, padding: 12, marginBottom: 20 },
  scheduleTitle: { fontSize: 9, fontWeight: 'bold', color: ORANGE_DARK, textTransform: 'uppercase', marginBottom: 8 },
  scheduleHeaderRow: { flexDirection: 'row', backgroundColor: ORANGE, paddingVertical: 5, paddingHorizontal: 8 },
  scheduleHeaderCell: { flex: 1, fontSize: 9, fontWeight: 'bold', color: '#fff' },
  scheduleRow: { flexDirection: 'row', borderBottom: `1pt solid ${YELLOW_BORDER}`, paddingVertical: 5, paddingHorizontal: 8 },
  scheduleCell: { flex: 1, fontSize: 10, color: '#555' },

  codeBox: { alignItems: 'center', border: `2pt dashed ${GREEN}`, borderRadius: 4, padding: 14, marginBottom: 20 },
  codeLabel: { fontSize: 9, color: GREY_LIGHT, textTransform: 'uppercase', marginBottom: 6 },
  codeValue: { fontSize: 18, fontWeight: 'bold', letterSpacing: 4, color: GREEN },

  noticeBox: { borderRadius: 4, padding: 14, marginBottom: 16 },
  noticeTitle: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 },
  noticeText: { fontSize: 10, color: '#444', lineHeight: 1.6 },
  noticeLink: { fontSize: 10, fontWeight: 'bold' },

  footer: { borderTop: '1pt solid #e0e0e0', paddingTop: 12, textAlign: 'center', fontSize: 9, color: '#aaa', lineHeight: 1.6 },
  footerStrong: { color: GREEN, fontWeight: 'bold' },
});

export interface InvoiceRoomLine {
  room_name: string;
  room_cap: string; // e.g. "2_Adults" — displayed with underscores replaced by spaces
  adults: number;
  children: number;
  quantity: number;
  unit_price: number; // nightly rate
  total: number; // full line total
}

export interface InvoiceData {
  invoiceNumber: string;
  bookingDate: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  eventName: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  guestCheckIn?: string;
  guestCheckOut?: string;
  rooms: InvoiceRoomLine[];
  transportTotal: number;
  grandTotal: number;
  depositPaid: number;
  balance: number;
  schedule: { installmentNumber: number; amount: number; dueDate: string; status: string }[];
  accessCode: string;
  myBookingUrl: string;
}

function guestLabel(adults: number, children: number) {
  let s = `${adults} adult${adults !== 1 ? 's' : ''}`;
  if (children > 0) s += `, ${children} child${children !== 1 ? 'ren' : ''}`;
  return s;
}

function InvoiceDocument({ data }: { data: InvoiceData }) {
  const roomTotal = data.grandTotal - data.transportTotal;
  const totalGuests = data.rooms.reduce((sum, r) => sum + r.adults + r.children, 0);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>KT Travel & More</Text>
            <Text style={styles.companySub}>Destination Wedding Travel Agency  |  Dallas, TX</Text>
          </View>
          <View>
            <Text style={styles.invoiceLabel}>INVOICE</Text>
            <Text style={styles.invoiceMeta}>
              Invoice #: {data.invoiceNumber}{'\n'}
              Date: {data.bookingDate}{'\n'}
              Booking Code: {data.accessCode}
            </Text>
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.partyCol}>
            <Text style={styles.partyLabel}>Billed To</Text>
            <Text style={styles.partyName}>{data.guestName}</Text>
            <Text style={styles.partyDetail}>{data.guestEmail}{data.guestPhone ? `\n${data.guestPhone}` : ''}</Text>
          </View>
          <View style={styles.partyCol}>
            <Text style={styles.partyLabel}>From</Text>
            <Text style={styles.partyName}>KT Travel & More</Text>
            <Text style={styles.partyDetail}>kttravelandmore.com{'\n'}Dallas, TX</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Event Details</Text>
        <View style={styles.eventBox}>
          <View style={styles.eventRow}>
            <View style={styles.eventCell}>
              <Text style={styles.eventFieldLabel}>Event</Text>
              <Text style={styles.eventFieldValue}>{data.eventName}</Text>
            </View>
            <View style={styles.eventCell}>
              <Text style={styles.eventFieldLabel}>Hotel</Text>
              <Text style={styles.eventFieldValue}>{data.hotelName}</Text>
            </View>
          </View>
          <View style={styles.eventRow}>
            <View style={styles.eventCell}>
              <Text style={styles.eventFieldLabel}>Check-In</Text>
              <Text style={styles.eventFieldValue}>{data.guestCheckIn || data.checkIn}</Text>
            </View>
            <View style={styles.eventCell}>
              <Text style={styles.eventFieldLabel}>Check-Out</Text>
              <Text style={styles.eventFieldValue}>{data.guestCheckOut || data.checkOut}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Room Booking Details</Text>
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.tableHeaderCell}>Room</Text>
            <Text style={styles.tableHeaderCell}>Capacity</Text>
            <Text style={styles.tableHeaderCell}>Guests</Text>
            <Text style={[styles.tableHeaderCell, styles.right]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.right]}>Unit Price</Text>
            <Text style={[styles.tableHeaderCell, styles.right]}>Total</Text>
          </View>
          {data.rooms.map((r, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.tableCell}>{r.room_name}</Text>
              <Text style={styles.tableCell}>{r.room_cap.replace(/_/g, ' ')}</Text>
              <Text style={styles.tableCell}>{guestLabel(r.adults, r.children)}</Text>
              <Text style={[styles.tableCell, styles.right]}>{r.quantity}</Text>
              <Text style={[styles.tableCell, styles.right]}>${r.unit_price.toFixed(2)}</Text>
              <Text style={[styles.tableCell, styles.right]}>${r.total.toFixed(2)}</Text>
            </View>
          ))}
          {data.transportTotal > 0 && (
            <View style={styles.tableRow}>
              <Text style={{ flex: 5, fontSize: 10, fontStyle: 'italic', color: '#444' }}>Transportation Add-on</Text>
              <Text style={[styles.tableCell, styles.right]}>${data.transportTotal.toFixed(2)}</Text>
            </View>
          )}
        </View>

        <View style={styles.totalsWrap}>
          <View style={styles.totalsSpacer} />
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Room Charges</Text>
              <Text style={styles.totalsValue}>${roomTotal.toFixed(2)}</Text>
            </View>
            {data.transportTotal > 0 && (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Transportation</Text>
                <Text style={styles.totalsValue}>${data.transportTotal.toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.totalsRow}>
              <Text style={[styles.totalsLabel, { fontWeight: 'bold', color: TEXT }]}>Grand Total</Text>
              <Text style={styles.totalsValue}>${data.grandTotal.toFixed(2)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsPaidLabel}>Deposit Paid</Text>
              <Text style={styles.totalsPaidValue}>- ${data.depositPaid.toFixed(2)}</Text>
            </View>
            <View style={styles.totalsGrandRow}>
              <Text style={styles.totalsGrandLabel}>Balance Due</Text>
              <Text style={styles.totalsGrandValue}>${data.balance.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {data.balance > 0 && data.schedule.length > 0 && (
          <View style={styles.scheduleBox}>
            <Text style={styles.scheduleTitle}>Payment Schedule</Text>
            <View style={styles.scheduleHeaderRow}>
              <Text style={styles.scheduleHeaderCell}>#</Text>
              <Text style={styles.scheduleHeaderCell}>Due Date</Text>
              <Text style={[styles.scheduleHeaderCell, styles.right]}>Amount</Text>
              <Text style={styles.scheduleHeaderCell}>Status</Text>
            </View>
            {data.schedule.map((s, i) => (
              <View style={styles.scheduleRow} key={i}>
                <Text style={styles.scheduleCell}>{s.installmentNumber}</Text>
                <Text style={styles.scheduleCell}>{s.dueDate}</Text>
                <Text style={[styles.scheduleCell, styles.right, { fontWeight: 'bold', color: TEXT }]}>${s.amount.toFixed(2)}</Text>
                <Text style={styles.scheduleCell}>{s.status === 'paid' ? 'Paid' : 'Pending'}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Your Booking Access Code — use this to view your booking</Text>
          <Text style={styles.codeValue}>{data.accessCode}</Text>
        </View>

        <View style={[styles.noticeBox, { backgroundColor: BLUE_BG, border: `1pt solid ${BLUE_BORDER}`, borderLeft: `4pt solid ${BLUE}` }]}>
          <Text style={[styles.noticeTitle, { color: BLUE }]}>Travel Protection — Recommended</Text>
          <Text style={styles.noticeText}>
            We strongly recommend adding travel protection to your reservation. Travel insurance can cover trip
            cancellations, medical emergencies, lost baggage, and other unexpected events.
          </Text>
          <Link
            style={[styles.noticeLink, { color: BLUE }]}
            src="https://legacy.travelinsured.com/agency/?r=https:%2F%2Flovekttam.com%2Ftravel-protection-scandrett&p=stephanie@kttravelandmore.com"
          >
            Click here to add Travel Protection
          </Link>
        </View>

        {totalGuests > 1 && (
          <View style={[styles.noticeBox, { backgroundColor: YELLOW_BG, border: `1pt solid ${YELLOW_BORDER}`, borderLeft: `4pt solid ${ORANGE_DARK}` }]}>
            <Text style={[styles.noticeTitle, { color: ORANGE_DARK }]}>Additional Guest Information Required</Text>
            <Text style={styles.noticeText}>
              Your booking includes {totalGuests} guests. We require the full name and date of birth for all guests
              on the reservation. Please email this information to us — your booking ID: {data.accessCode}.
            </Text>
          </View>
        )}

        <View style={[styles.noticeBox, { backgroundColor: CHANGE_BG, border: `1pt solid ${CHANGE_BORDER}`, borderLeft: `4pt solid ${CHANGE_GREEN}` }]}>
          <Text style={[styles.noticeTitle, { color: CHANGE_GREEN }]}>Need to Make Changes to Your Reservation?</Text>
          <Text style={styles.noticeText}>
            If you need to update or modify your reservation, visit your personal booking page. Enter your booking
            access code — {data.accessCode} — and submit your change request directly from there.
          </Text>
          <Link style={[styles.noticeLink, { color: CHANGE_GREEN }]} src={data.myBookingUrl}>
            View My Booking & Request Changes
          </Link>
        </View>

        <View style={styles.footer}>
          <Text><Text style={styles.footerStrong}>KT Travel & More</Text>  |  kttravelandmore.com  |  Dallas, TX</Text>
          <Text>Thank you for choosing KT Travel & More. This invoice was generated automatically upon payment.</Text>
          <Text>For questions or changes, visit your booking page or contact us directly.</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
