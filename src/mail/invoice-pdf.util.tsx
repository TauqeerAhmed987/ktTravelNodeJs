import { Document, Page, Text, View, StyleSheet, Link, renderToBuffer } from '@react-pdf/renderer';

// Guest invoice (attached to the confirmation e-mail and downloadable from My Booking / the
// dashboard). Same sections and brand colours as the old kt_travel_web pdf/invoice.blade.php,
// laid out as a cleaner one-page document: formatted dates and amounts, nights shown, payment
// status pills, and no box ever split across two pages.
const GREEN = '#325440';
const GREEN_DARK = '#243d2f';
const GREEN_SOFT = '#eef4f0';
const GREEN_LINE = '#d6e3da';
const PAID = '#2e7d32';
const PAID_BG = '#e3f2e5';
const AMBER = '#b45309';
const AMBER_BG = '#fff4dc';
const BLUE = '#2471a3';
const BLUE_BG = '#eaf4fb';
const ORANGE = '#c2410c';
const ORANGE_BG = '#fff6ec';
const TEXT = '#2b2b2b';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const LINE = '#e5e7eb';
const ZEBRA = '#f8faf9';

const styles = StyleSheet.create({
  // paddingTop gives every later page a top margin; the header band cancels it on page 1
  page: { paddingTop: 36, paddingBottom: 56, paddingHorizontal: 0, fontSize: 10, color: TEXT, fontFamily: 'Helvetica' },
  body: { paddingHorizontal: 36 },

  // header band
  band: { marginTop: -36, backgroundColor: GREEN, paddingHorizontal: 36, paddingTop: 26, paddingBottom: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  brand: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#fff', letterSpacing: 0.5 },
  brandSub: { fontSize: 9, color: '#c9dccf', marginTop: 4 },
  invoiceWord: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: '#fff', letterSpacing: 3, textAlign: 'right' },
  accentBar: { height: 4, backgroundColor: '#8fb39b' },

  // meta strip under the band
  metaStrip: { flexDirection: 'row', marginHorizontal: 36, marginTop: 16, marginBottom: 18, borderWidth: 1, borderColor: LINE, borderRadius: 6 },
  metaCell: { flex: 1, paddingVertical: 9, paddingHorizontal: 12, borderRightWidth: 1, borderRightColor: LINE },
  metaCellLast: { flex: 1, paddingVertical: 9, paddingHorizontal: 12, alignItems: 'flex-start' },
  metaLabel: { fontSize: 7.5, color: FAINT, textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValue: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: TEXT, marginTop: 3 },
  pill: { marginTop: 3, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 9, fontSize: 8.5, fontFamily: 'Helvetica-Bold' },

  // parties + stay
  twoCol: { flexDirection: 'row', marginBottom: 16 },
  card: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 12 },
  cardGap: { width: 12 },
  cardLabel: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 7 },
  cardName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: TEXT, marginBottom: 3 },
  cardText: { fontSize: 9.5, color: MUTED, lineHeight: 1.5 },

  stayCard: { flex: 1, backgroundColor: GREEN_SOFT, borderWidth: 1, borderColor: GREEN_LINE, borderRadius: 6, padding: 12 },
  stayGrid: { flexDirection: 'row', marginTop: 8 },
  stayCell: { flex: 1 },
  stayLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  stayValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: TEXT, marginTop: 2 },

  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: GREEN, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },

  // line items
  table: { borderWidth: 1, borderColor: LINE, borderRadius: 6, marginBottom: 16 },
  thRow: { flexDirection: 'row', backgroundColor: GREEN, paddingVertical: 7, paddingHorizontal: 8, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#fff', paddingHorizontal: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  tr: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: LINE },
  td: { fontSize: 9.5, color: TEXT, paddingHorizontal: 4 },
  tdSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },

  // totals + access code side by side
  summaryRow: { flexDirection: 'row', marginBottom: 16 },
  codeCard: { flex: 1, borderWidth: 1.5, borderColor: GREEN, borderStyle: 'dashed', borderRadius: 6, padding: 12, alignItems: 'center', justifyContent: 'center' },
  codeLabel: { fontSize: 7.5, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  codeValue: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: GREEN, letterSpacing: 5, marginTop: 6, marginBottom: 6 },
  codeHint: { fontSize: 8, color: MUTED, textAlign: 'center' },
  codeLink: { fontSize: 8.5, color: GREEN, fontFamily: 'Helvetica-Bold', marginTop: 4, textDecoration: 'none' },

  totals: { flex: 1.15 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: LINE },
  tLabel: { fontSize: 9.5, color: MUTED },
  tValue: { fontSize: 9.5, color: TEXT, fontFamily: 'Helvetica-Bold' },
  balanceBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: GREEN_DARK, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12, marginTop: 8 },
  balanceLabel: { fontSize: 10, color: '#d7e6dc', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.8 },
  balanceValue: { fontSize: 16, color: '#fff', fontFamily: 'Helvetica-Bold' },

  // schedule
  schedRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: LINE },

  // notices
  notice: { borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10, borderLeftWidth: 4 },
  noticeTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  noticeText: { fontSize: 9, color: '#374151', lineHeight: 1.5 },
  noticeLink: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 4, textDecoration: 'none' },

  // footer on every page
  footer: { position: 'absolute', bottom: 18, left: 36, right: 36, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 8, color: FAINT },
  footerBrand: { fontSize: 8, color: GREEN, fontFamily: 'Helvetica-Bold' },
});

// Column widths (flex)
const COLS = { desc: 3.2, guests: 1.9, nights: 0.9, qty: 0.6, rate: 1.3, amount: 1.4 };
const SCHED = { num: 0.5, due: 2, amount: 1.4, status: 1.2 };

export interface InvoiceRoomLine {
  room_name: string;
  room_cap: string; // e.g. "2_Adults" — displayed with underscores replaced by spaces
  adults: number;
  children: number;
  quantity: number;
  unit_price: number; // one room for the whole stay
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
  depositPaid: number; // everything paid so far (deposit + paid installments)
  balance: number;
  schedule: { installmentNumber: number; amount: number; dueDate: string; status: string }[];
  accessCode: string;
  myBookingUrl: string;
}

const money = (v: number) =>
  `$${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "2026-11-02", "2026-11-02T00:00:00Z", "11/2/2026" or a Date → "Nov 2, 2026".
// A bare YYYY-MM-DD is read as a calendar day (not UTC midnight) so it never shifts a day.
function parseDay(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtDate(v: unknown) {
  const d = parseDay(v);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : String(v ?? '—');
}
function nightsBetween(a: unknown, b: unknown) {
  const x = parseDay(a);
  const y = parseDay(b);
  if (!x || !y) return null;
  const n = Math.round((y.getTime() - x.getTime()) / 86400000);
  return n > 0 ? n : null;
}

// "2_Adult" / "2 adult 1 child" → "2 Adults" / "2 Adults, 1 Child"
function capacityLabel(cap: string) {
  const text = cap.replace(/_/g, ' ').toLowerCase();
  const a = /(\d+)\s*adults?/.exec(text);
  const c = /(\d+)\s*child(?:ren)?/.exec(text);
  if (!a && !c) return cap.replace(/_/g, ' ');
  const ad = a ? Number(a[1]) : 0;
  const ch = c ? Number(c[1]) : 0;
  const out = `${ad} ${ad === 1 ? 'Adult' : 'Adults'}`;
  return ch > 0 ? `${out}, ${ch} ${ch === 1 ? 'Child' : 'Children'}` : out;
}

function guestLabel(adults: number, children: number) {
  let s = `${adults} adult${adults !== 1 ? 's' : ''}`;
  if (children > 0) s += `, ${children} child${children !== 1 ? 'ren' : ''}`;
  return s;
}

function StatusPill({ paid }: { paid: boolean }) {
  return (
    <Text style={[styles.pill, { backgroundColor: paid ? PAID_BG : AMBER_BG, color: paid ? PAID : AMBER }]}>
      {paid ? 'PAID' : 'PENDING'}
    </Text>
  );
}

function InvoiceDocument({ data }: { data: InvoiceData }) {
  const roomTotal = data.grandTotal - data.transportTotal;
  const totalGuests = data.rooms.reduce((sum, r) => sum + (r.adults + r.children) * Math.max(1, r.quantity), 0);
  const checkIn = data.guestCheckIn || data.checkIn;
  const checkOut = data.guestCheckOut || data.checkOut;
  const nights = nightsBetween(checkIn, checkOut);
  const paidInFull = data.balance <= 0;
  const guestMail =
    `mailto:info@kttravelandmore.com?subject=${encodeURIComponent(`Guest Information - Booking #${data.invoiceNumber} (${data.accessCode})`)}` +
    `&body=${encodeURIComponent(`Booking ID: ${data.accessCode}\n\nPlease provide the following for each additional guest:\n\nGuest 2:\n- Full Name:\n- Date of Birth:\n`)}`;

  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author="KT Travel & More">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.band}>
          <View>
            <Text style={styles.brand}>KT Travel & More</Text>
            <Text style={styles.brandSub}>Destination Wedding Travel Agency  ·  Dallas, TX</Text>
          </View>
          <Text style={styles.invoiceWord}>INVOICE</Text>
        </View>
        <View style={styles.accentBar} />

        <View style={styles.metaStrip}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Invoice #</Text>
            <Text style={styles.metaValue}>{data.invoiceNumber}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Issue Date</Text>
            <Text style={styles.metaValue}>{fmtDate(data.bookingDate)}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Booking Code</Text>
            <Text style={styles.metaValue}>{data.accessCode}</Text>
          </View>
          <View style={styles.metaCellLast}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={[styles.pill, paidInFull ? { backgroundColor: PAID_BG, color: PAID } : { backgroundColor: AMBER_BG, color: AMBER }]}>
              {paidInFull ? 'PAID IN FULL' : 'BALANCE DUE'}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Billed to + stay */}
          <View style={styles.twoCol} wrap={false}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Billed To</Text>
              <Text style={styles.cardName}>{data.guestName}</Text>
              <Text style={styles.cardText}>{data.guestEmail}</Text>
              {!!data.guestPhone && <Text style={styles.cardText}>{data.guestPhone}</Text>}
              <Text style={[styles.cardLabel, { marginTop: 10, marginBottom: 3 }]}>From</Text>
              <Text style={styles.cardText}>KT Travel & More  ·  kttravelandmore.com  ·  Dallas, TX</Text>
            </View>
            <View style={styles.cardGap} />
            <View style={styles.stayCard}>
              <Text style={styles.cardLabel}>Event & Stay</Text>
              <Text style={styles.cardName}>{data.eventName}</Text>
              <Text style={styles.cardText}>{data.hotelName}</Text>
              <View style={styles.stayGrid}>
                <View style={styles.stayCell}>
                  <Text style={styles.stayLabel}>Check-In</Text>
                  <Text style={styles.stayValue}>{fmtDate(checkIn)}</Text>
                </View>
                <View style={styles.stayCell}>
                  <Text style={styles.stayLabel}>Check-Out</Text>
                  <Text style={styles.stayValue}>{fmtDate(checkOut)}</Text>
                </View>
                <View style={[styles.stayCell, { flex: 0.6 }]}>
                  <Text style={styles.stayLabel}>Nights</Text>
                  <Text style={styles.stayValue}>{nights ?? '—'}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Line items */}
          <Text style={styles.sectionTitle}>Room Booking Details</Text>
          <View style={styles.table} wrap={false}>
            <View style={styles.thRow}>
              <Text style={[styles.th, { flex: COLS.desc }]}>Room</Text>
              <Text style={[styles.th, { flex: COLS.guests }]}>Guests / Room</Text>
              <Text style={[styles.th, styles.center, { flex: COLS.nights }]}>Nights</Text>
              <Text style={[styles.th, styles.center, { flex: COLS.qty }]}>Qty</Text>
              <Text style={[styles.th, styles.right, { flex: COLS.rate }]}>Per Room</Text>
              <Text style={[styles.th, styles.right, { flex: COLS.amount }]}>Amount</Text>
            </View>
            {data.rooms.map((r, i) => (
              <View style={[styles.tr, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} key={i}>
                <View style={{ flex: COLS.desc, paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: TEXT }}>{r.room_name}</Text>
                  <Text style={styles.tdSub}>Room for {capacityLabel(r.room_cap)}</Text>
                </View>
                <Text style={[styles.td, { flex: COLS.guests }]}>{guestLabel(r.adults, r.children)}</Text>
                <Text style={[styles.td, styles.center, { flex: COLS.nights }]}>{nights ?? '—'}</Text>
                <Text style={[styles.td, styles.center, { flex: COLS.qty }]}>{r.quantity}</Text>
                <Text style={[styles.td, styles.right, { flex: COLS.rate }]}>{money(r.unit_price)}</Text>
                <Text style={[styles.td, styles.right, { flex: COLS.amount, fontFamily: 'Helvetica-Bold' }]}>{money(r.total)}</Text>
              </View>
            ))}
            {data.transportTotal > 0 && (
              <View style={[styles.tr, data.rooms.length % 2 === 1 ? { backgroundColor: ZEBRA } : {}]}>
                <View style={{ flex: COLS.desc + COLS.guests + COLS.nights + COLS.qty + COLS.rate, paddingHorizontal: 4 }}>
                  <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: TEXT }}>Transportation Add-on</Text>
                  <Text style={styles.tdSub}>Airport / venue transfers</Text>
                </View>
                <Text style={[styles.td, styles.right, { flex: COLS.amount, fontFamily: 'Helvetica-Bold' }]}>{money(data.transportTotal)}</Text>
              </View>
            )}
          </View>

          {/* Access code + totals */}
          <View style={styles.summaryRow} wrap={false}>
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>Your Booking Access Code</Text>
              <Text style={styles.codeValue}>{data.accessCode}</Text>
              <Text style={styles.codeHint}>Use this code to view your booking at any time.</Text>
              <Link style={styles.codeLink} src={data.myBookingUrl}>View My Booking</Link>
            </View>
            <View style={{ width: 16 }} />
            <View style={styles.totals}>
              <View style={styles.tRow}>
                <Text style={styles.tLabel}>Room Charges</Text>
                <Text style={styles.tValue}>{money(roomTotal)}</Text>
              </View>
              {data.transportTotal > 0 && (
                <View style={styles.tRow}>
                  <Text style={styles.tLabel}>Transportation</Text>
                  <Text style={styles.tValue}>{money(data.transportTotal)}</Text>
                </View>
              )}
              <View style={styles.tRow}>
                <Text style={[styles.tLabel, { color: TEXT, fontFamily: 'Helvetica-Bold' }]}>Grand Total</Text>
                <Text style={[styles.tValue, { fontSize: 11 }]}>{money(data.grandTotal)}</Text>
              </View>
              <View style={[styles.tRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.tLabel, { color: PAID }]}>Amount Paid</Text>
                <Text style={[styles.tValue, { color: PAID }]}>– {money(data.depositPaid)}</Text>
              </View>
              <View style={styles.balanceBox}>
                <Text style={styles.balanceLabel}>Balance Due</Text>
                <Text style={styles.balanceValue}>{money(Math.max(0, data.balance))}</Text>
              </View>
            </View>
          </View>

          {/* Payment schedule */}
          {data.schedule.length > 0 && (
            <View wrap={false}>
              <Text style={styles.sectionTitle}>Payment Schedule</Text>
              <View style={styles.table}>
                <View style={styles.thRow}>
                  <Text style={[styles.th, { flex: SCHED.num }]}>#</Text>
                  <Text style={[styles.th, { flex: SCHED.due }]}>Due Date</Text>
                  <Text style={[styles.th, styles.right, { flex: SCHED.amount }]}>Amount</Text>
                  <Text style={[styles.th, styles.right, { flex: SCHED.status }]}>Status</Text>
                </View>
                {data.schedule.map((s, i) => (
                  <View style={[styles.schedRow, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]} key={i}>
                    <Text style={[styles.td, { flex: SCHED.num }]}>{s.installmentNumber}</Text>
                    <Text style={[styles.td, { flex: SCHED.due }]}>{fmtDate(s.dueDate)}</Text>
                    <Text style={[styles.td, styles.right, { flex: SCHED.amount, fontFamily: 'Helvetica-Bold' }]}>{money(s.amount)}</Text>
                    <View style={{ flex: SCHED.status, alignItems: 'flex-end', paddingHorizontal: 4 }}>
                      <StatusPill paid={s.status === 'paid'} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Notices */}
          <Text style={[styles.sectionTitle, { marginTop: 4 }]} minPresenceAhead={90}>Important Information</Text>
          <View style={[styles.notice, { backgroundColor: BLUE_BG, borderLeftColor: BLUE }]} wrap={false}>
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
            <View style={[styles.notice, { backgroundColor: ORANGE_BG, borderLeftColor: ORANGE }]} wrap={false}>
              <Text style={[styles.noticeTitle, { color: ORANGE }]}>Additional Guest Information Required</Text>
              <Text style={styles.noticeText}>
                Your booking includes {totalGuests} guests. We require the full name and date of birth for all guests on
                the reservation. Please email this information to us — your booking ID: {data.accessCode}.
              </Text>
              <Link style={[styles.noticeLink, { color: ORANGE }]} src={guestMail}>
                Send Guest Information
              </Link>
            </View>
          )}

          <View style={[styles.notice, { backgroundColor: GREEN_SOFT, borderLeftColor: GREEN }]} wrap={false}>
            <Text style={[styles.noticeTitle, { color: GREEN }]}>Need to Make Changes to Your Reservation?</Text>
            <Text style={styles.noticeText}>
              Visit your personal booking page, enter your access code — {data.accessCode} — and submit your change
              request. Our team will review and confirm it promptly.
            </Text>
            <Link style={[styles.noticeLink, { color: GREEN }]} src={data.myBookingUrl}>
              View My Booking & Request Changes
            </Link>
          </View>

          <Text style={{ fontSize: 9, color: MUTED, textAlign: 'center', marginTop: 8 }} wrap={false}>
            Thank you for choosing KT Travel & More!
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            <Text style={styles.footerBrand}>KT Travel & More</Text>  ·  kttravelandmore.com  ·  Dallas, TX  ·  Generated automatically upon payment
          </Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
