import { PrismaClient, Prisma } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Capacity labels
//
// The same capacity is written several ways across the data: "4_Adults",
// "1_Adult_1_Child", "2_Adults_3_Children" (event form / rooms.room_capacity) and
// "2 adult 0 child" (old system / capacity table). Everything below compares them
// by what they MEAN (adults + children), not by their spelling.
// ---------------------------------------------------------------------------
export interface Occupancy {
  adults: number;
  children: number;
}

export function parseCapacity(label: string | null | undefined): Occupancy | null {
  if (!label) return null;
  const text = label.replace(/_/g, ' ').toLowerCase();
  const a = /(\d+)\s*adults?/.exec(text);
  const c = /(\d+)\s*child(?:ren)?/.exec(text);
  if (!a && !c) return null;
  return { adults: a ? Number(a[1]) : 0, children: c ? Number(c[1]) : 0 };
}

export function normalizeCapacity(label: string | null | undefined): string {
  const o = parseCapacity(label);
  if (o) return `${o.adults}a${o.children}c`;
  return (label ?? '').replace(/_/g, ' ').trim().toLowerCase();
}

export function sameCapacity(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeCapacity(a) === normalizeCapacity(b);
}

export function splitCsv(value: string | null | undefined): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

// Highest number of adults / total people any of the room's capacity options allows.
// 0 means "unknown" (no parsable capacity data) — callers then skip the check.
export function maxOccupancy(capacities: string[]): { maxAdults: number; maxPeople: number } {
  let maxAdults = 0;
  let maxPeople = 0;
  for (const cap of capacities) {
    const o = parseCapacity(cap);
    if (!o) continue;
    maxAdults = Math.max(maxAdults, o.adults);
    maxPeople = Math.max(maxPeople, o.adults + o.children);
  }
  return { maxAdults, maxPeople };
}

// Can a party of this size stay in a room sold as `capacity`? null = capacity not
// parsable (legacy free text) — treated as "fits" so old events keep working.
export function fitsCapacity(capacity: string | null | undefined, adults: number, children: number): boolean | null {
  const o = parseCapacity(capacity);
  if (!o) return null;
  return adults <= o.adults && adults + children <= o.adults + o.children;
}

// The capacity options a party is allowed to book: only those it fits AND none that is
// bigger than needed — otherwise 2 adults could pick the "4 adults" option and pay its
// lower per-person rate. Options of equal size are all allowed. Unparsable options are
// always allowed (legacy data).
export function allowedCapacities(capacities: string[], adults: number, children: number): string[] {
  const fitting = capacities.filter((c) => fitsCapacity(c, adults, children) === true);
  const sizeOf = (c: string) => {
    const o = parseCapacity(c)!;
    return o.adults + o.children;
  };
  const smallest = fitting.length ? Math.min(...fitting.map(sizeOf)) : null;
  return capacities.filter((c) => {
    const fit = fitsCapacity(c, adults, children);
    if (fit === null) return true;
    return fit && sizeOf(c) === smallest;
  });
}

// Human label for a capacity slug: "2_Adults_1_Child" -> "2 Adults, 1 Child"
export function capacityLabel(capacity: string | null | undefined): string {
  const o = parseCapacity(capacity);
  if (!o) return (capacity ?? '').replace(/_/g, ' ').trim();
  const a = `${o.adults} ${o.adults === 1 ? 'Adult' : 'Adults'}`;
  return o.children > 0 ? `${a}, ${o.children} ${o.children === 1 ? 'Child' : 'Children'}` : a;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
// Today as "YYYY-MM-DD" in the server's local time zone.
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// An event takes bookings while at least one night is still possible: the first bookable
// check-in is the later of the event start and today, and it must be before the event end.
export function isEventClosed(eventCheckOut: string | null | undefined): boolean {
  const end = toIsoDay(eventCheckOut);
  if (!end) return false;
  return todayIso() >= end;
}

// Accepts "YYYY-MM-DD" (optionally followed by a time) and rejects impossible
// dates such as 2026-02-31; returns the canonical "YYYY-MM-DD" or null.
export function toIsoDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86400000);
}

// ---------------------------------------------------------------------------
// Room inventory
//
// An event's `eventrooms` row stores, per capacity option, how many rooms of that
// type exist (`no_of_rooms`, comma-joined like the prices). Availability is DERIVED
// as   total - rooms held by active bookings   so it drops the moment a booking is
// made and comes back the moment it is cancelled — there is no counter to drift.
//
// A stored value of 0 / empty means "not tracked" (older events) and is treated as
// unlimited so existing events keep selling exactly as before.
// ---------------------------------------------------------------------------
export interface Stock {
  total: number | null; // null = not tracked
  booked: number;
  available: number | null; // null = not tracked
}

export async function computeStock(
  db: Db,
  eventId: number,
  eventrooms: { room_name: string | null; room_cap: string | null; no_of_rooms: string | null }[],
  excludeBookingId?: number,
): Promise<Map<string, Stock>> {
  const rows = await db.bookingrooms.findMany({
    where: { event_id: String(eventId) },
    select: { booking_id: true, room_id: true, room_cap: true, quantity: true },
  });
  const ids = [...new Set(rows.map((r) => Number(r.booking_id)).filter((n) => Number.isFinite(n)))];
  const cancelled = new Set<number>(
    ids.length
      ? (
          await db.bookings.findMany({
            where: { booking_id: { in: ids }, status: 'cancelled' },
            select: { booking_id: true },
          })
        ).map((b) => b.booking_id)
      : [],
  );

  const result = new Map<string, Stock>();
  for (const er of eventrooms) {
    const caps = splitCsv(er.room_cap);
    const counts = splitCsv(er.no_of_rooms);
    caps.forEach((cap, i) => {
      const n = Number(counts[i] ?? '');
      const total = Number.isFinite(n) && n > 0 ? n : null;
      const booked = rows
        .filter(
          (r) =>
            r.room_id === er.room_name &&
            sameCapacity(r.room_cap, cap) &&
            !cancelled.has(Number(r.booking_id)) &&
            Number(r.booking_id) !== excludeBookingId,
        )
        .reduce((sum, r) => sum + Math.max(1, Number(r.quantity ?? 1)), 0);
      result.set(stockKey(er.room_name, cap), {
        total,
        booked,
        available: total === null ? null : Math.max(0, total - booked),
      });
    });
  }
  return result;
}

export function stockKey(roomId: string | null, cap: string): string {
  return `${roomId ?? ''}|${normalizeCapacity(cap)}`;
}

// ---------------------------------------------------------------------------
// Installments
//
// Like the deposit, a "percent" installment is a percentage of the booking's GRAND
// TOTAL: deposit 30% + installments 50% + 20% = 100% of the total (as admins enter
// it, and as the event guide describes). The deposit is charged at booking time and
// the schedule is then made to add up to exactly the balance left — rounding, fixed
// amounts or percentages that don't reach 100% are absorbed by the last installment,
// so the booking always ends at a zero balance and never over-collects.
// ---------------------------------------------------------------------------
export function buildInstallmentAmounts(
  defs: { amount_type: string; amount: unknown }[],
  balance: number,
  grandTotal: number,
): number[] {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  if (defs.length === 0) return [];
  const raw = defs.map((d) =>
    d.amount_type === 'percent' ? round2((grandTotal * Number(d.amount)) / 100) : round2(Number(d.amount)),
  );
  const sum = round2(raw.reduce((a, b) => a + b, 0));
  if (sum === round2(balance)) return raw;

  const last = raw.length - 1;
  const adjusted = round2(raw[last] + (balance - sum));
  if (adjusted >= 0) {
    raw[last] = adjusted;
    return raw;
  }
  // The earlier installments alone already exceed the balance: scale them all down proportionally
  const factor = sum > 0 ? balance / sum : 0;
  const scaled = raw.map((v) => round2(v * factor));
  scaled[last] = round2(balance - scaled.slice(0, last).reduce((a, b) => a + b, 0));
  return scaled;
}
