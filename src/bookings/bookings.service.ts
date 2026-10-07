import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { generateInvoicePdf } from '../mail/invoice-pdf.util.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { PayInstallmentDto } from './dto/pay-installment.dto.js';
import { UpdateBookingDto } from './dto/update-booking.dto.js';
import { CancelBookingDto } from './dto/cancel-booking.dto.js';
import {
  allowedCapacities,
  buildInstallmentAmounts,
  capacityLabel,
  computeStock,
  fitsCapacity,
  isEventClosed,
  maxOccupancy,
  nightsBetween,
  parseCapacity,
  sameCapacity,
  splitCsv,
  stockKey,
  toIsoDay,
  todayIso,
} from './booking-rules.util.js';
import {
  calculateDeposit,
  resolveRoomLine,
  resolveRoomRate,
  totalPeopleForTransport,
} from './booking-pricing.util.js';

type Db = PrismaClient | Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class BookingsService {
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET') as string);
  }

  // Every guest reservation for a given event, for the admin's
  // Events -> Select Event -> Reservation Overview screen.
  async findByEvent(eventId: number) {
    const rooms = await this.prisma.bookingrooms.findMany({
      where: { event_id: String(eventId) },
    });
    const bookingIds = [
      ...new Set(rooms.map((r) => Number(r.booking_id)).filter(Boolean)),
    ];
    if (bookingIds.length === 0) return [];

    const bookings = await this.prisma.bookings.findMany({
      where: { booking_id: { in: bookingIds } },
      orderBy: { created_at: 'desc' },
    });

    // Guest contact + room names, resolved here so the reservation table can
    // render one row per booked room without extra round-trips.
    const userIds = [
      ...new Set(bookings.map((b) => Number(b.user_id)).filter((n) => Number.isFinite(n) && n > 0)),
    ];
    const roomIds = [
      ...new Set(rooms.map((r) => Number(r.room_id)).filter((n) => Number.isFinite(n) && n > 0)),
    ];
    const [users, roomRows] = await Promise.all([
      userIds.length
        ? this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true, client_phone: true },
          })
        : [],
      roomIds.length
        ? this.prisma.rooms.findMany({
            where: { rooms_id: { in: roomIds } },
            select: { rooms_id: true, room_name: true },
          })
        : [],
    ]);
    const userById = new Map(users.map((u) => [Number(u.id), u]));
    const roomNameById = new Map(roomRows.map((r) => [r.rooms_id, r.room_name]));

    return bookings.map((booking) => {
      const guest = userById.get(Number(booking.user_id));
      return {
        ...booking,
        // Details typed by the guest at checkout live on the booking itself; the linked
        // user is only a fallback for bookings made before those columns existed.
        guest_name: booking.guest_name ?? guest?.name ?? null,
        guest_email: booking.guest_email ?? guest?.email ?? null,
        guest_phone: booking.guest_phone ?? guest?.client_phone ?? null,
        rooms: rooms
          .filter((r) => Number(r.booking_id) === booking.booking_id)
          .map((r) => ({ ...r, room_display_name: roomNameById.get(Number(r.room_id)) ?? null })),
      };
    });
  }

  async findOne(bookingId: number) {
    const booking = await this.prisma.bookings.findUnique({
      where: { booking_id: bookingId },
    });
    if (!booking) throw new NotFoundException('Reservation not found.');

    const [rooms, paymentSchedules] = await Promise.all([
      this.prisma.bookingrooms.findMany({
        where: { booking_id: String(bookingId) },
      }),
      this.prisma.payment_schedules.findMany({
        where: { booking_id: bookingId },
        orderBy: { installment_number: 'asc' },
      }),
    ]);

    return { ...booking, rooms, paymentSchedules };
  }

  // Public — the guest's "My Booking" page. Reuses getReservationDetail's
  // full join (guest/event/hotel/room names, not just raw ids) since a guest
  // needs the same richness the admin Reservation Detail page shows, just
  // scoped by their own access_code instead of a JWT + numeric booking id.
  async findByAccessCode(accessCode: string) {
    const booking = await this.prisma.bookings.findUnique({
      where: { access_code: accessCode },
    });
    if (!booking) throw new NotFoundException('Invalid booking access code.');
    const detail = await this.getReservationDetail(booking.booking_id);
    // the admin's note on a change request is internal
    return { ...detail, changeRequests: detail.changeRequests.map(({ admin_note, ...r }) => r) };
  }

  async getInvoicePdfByAccessCode(accessCode: string) {
    const booking = await this.prisma.bookings.findUnique({
      where: { access_code: accessCode },
    });
    if (!booking) throw new NotFoundException('Invalid booking access code.');
    return this.getInvoicePdf(booking.booking_id);
  }

  // A guest's free-text change request from My Booking. Stored so the admin sees it in
  // the dashboard even if the notification e-mail never arrives; the e-mail is sent in
  // the background so the guest is not kept waiting on the mail server.
  async requestChange(accessCode: string, message: string) {
    const booking = await this.prisma.bookings.findUnique({
      where: { access_code: accessCode },
    });
    if (!booking) throw new NotFoundException('Invalid booking access code.');

    const guest = booking.user_id
      ? await this.prisma.users.findUnique({ where: { id: BigInt(booking.user_id) } })
      : null;
    const guestName = booking.guest_name ?? guest?.name ?? 'Guest';
    const guestEmail = booking.guest_email ?? guest?.email ?? null;

    await this.prisma.booking_change_requests.create({
      data: {
        booking_id: booking.booking_id,
        access_code: booking.access_code,
        guest_name: guestName,
        guest_email: guestEmail,
        message: message.trim(),
      },
    });

    void this.mail
      .sendChangeRequest({ guestName, guestEmail: guestEmail ?? 'N/A', accessCode, message })
      .catch(() => undefined);

    return { sent: true };
  }

  async listChangeRequests(status?: string) {
    const rows = await this.prisma.booking_change_requests.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    });
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  async countOpenChangeRequests() {
    return { open: await this.prisma.booking_change_requests.count({ where: { status: 'open' } }) };
  }

  async updateChangeRequest(id: number, status: 'open' | 'resolved', adminNote?: string) {
    const existing = await this.prisma.booking_change_requests.findUnique({ where: { id: BigInt(id) } });
    if (!existing) throw new NotFoundException('Change request not found.');
    const row = await this.prisma.booking_change_requests.update({
      where: { id: BigInt(id) },
      data: {
        status,
        admin_note: adminNote !== undefined ? adminNote.trim() || null : undefined,
        resolved_at: status === 'resolved' ? new Date() : null,
      },
    });
    return { ...row, id: Number(row.id) };
  }

  async pausePayments(bookingId: number, reason?: string) {
    await this.findOne(bookingId);
    const [booking] = await Promise.all([
      this.prisma.bookings.update({
        where: { booking_id: bookingId },
        data: { payment_paused: 1, pause_reason: reason ?? null },
      }),
      this.prisma.payment_schedules.updateMany({
        where: { booking_id: bookingId, status: 'pending' },
        data: { status: 'paused' },
      }),
    ]);
    return booking;
  }

  async resumePayments(bookingId: number) {
    await this.findOne(bookingId);
    const [booking] = await Promise.all([
      this.prisma.bookings.update({
        where: { booking_id: bookingId },
        data: { payment_paused: 0, pause_reason: null },
      }),
      this.prisma.payment_schedules.updateMany({
        where: { booking_id: bookingId, status: 'paused' },
        data: { status: 'pending' },
      }),
    ]);
    return booking;
  }

  // The admin Reservation Detail page's full read model — mirrors
  // ClientController::reservationDetail()'s exact join (bookings ->
  // bookingrooms -> rooms/users/events/hotels, hotels/rooms joined by id per
  // the legacy hotel_name/room_name-holds-an-id convention established
  // elsewhere in this codebase), plus the event's available room types (for
  // the room-type dropdown in the edit form) and the full payment schedule.
  async getReservationDetail(bookingId: number) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        bookings.booking_id, bookings.user_id, bookings.access_code,
        bookings.total_card_amount, bookings.total_amount_after_percent,
        bookings.balance, bookings.nextpayment, bookings.nextmonthdate,
        bookings.payment_paused, bookings.pause_reason, bookings.transport_total,
        bookings.created_at, bookings.comments, bookings.status, bookings.cancelled_at, bookings.cancel_reason,
        COALESCE(bookings.guest_name, users.name) AS guest_name,
        COALESCE(bookings.guest_email, users.email) AS guest_email,
        COALESCE(bookings.guest_phone, users.client_phone) AS guest_phone,
        bookingrooms.bookingroom_id, bookingrooms.event_id,
        bookingrooms.checkin, bookingrooms.checkout,
        bookingrooms.quantity, bookingrooms.room_price, bookingrooms.room_actual_price,
        bookingrooms.adults, bookingrooms.children, bookingrooms.child_age,
        bookingrooms.room_id, bookingrooms.room_cap,
        rooms.room_name,
        events.event_id AS event_pk, events.event_name, events.check_in, events.check_out,
        hotels.hotel_name, hotels.hotel_location
      FROM bookings
      LEFT JOIN bookingrooms ON bookingrooms.booking_id = bookings.booking_id
      LEFT JOIN rooms ON rooms.rooms_id = bookingrooms.room_id
      LEFT JOIN users ON users.id = bookings.user_id
      LEFT JOIN events ON events.event_id = bookingrooms.event_id
      LEFT JOIN hotels ON hotels.hotel_id = events.hotel_name
      WHERE bookings.booking_id = ${bookingId}
      LIMIT 1
    `;
    const booking = rows[0];
    if (!booking) throw new NotFoundException('Reservation not found.');

    const paymentSchedule = await this.prisma.payment_schedules.findMany({
      where: { booking_id: bookingId },
      orderBy: { installment_number: 'asc' },
    });

    // total_amount_after_percent is the DEPOSIT (both this system and the old Laravel app
    // only lower `balance` when an installment is paid), so the total paid so far is the
    // deposit plus every paid installment.
    booking.amount_paid = round2(
      Number(booking.total_amount_after_percent ?? 0) +
        paymentSchedule.filter((s) => s.status === 'paid').reduce((sum, s) => sum + Number(s.amount), 0),
    );

    let rooms: { rooms_id: number; room_name: string | null }[] = [];
    // Rate of every capacity option + the guest limits of every room type of this event:
    // the admin edit form uses them to switch the rate when adults/children change.
    const rates: { room_id: string; cap: string; adults: number; children: number; rate: number }[] = [];
    const occupancy: Record<string, { maxAdults: number; maxPeople: number }> = {};
    if (booking.event_id) {
      const eventrooms = await this.prisma.eventrooms.findMany({
        where: { event_id: String(booking.event_id) },
      });
      const roomIds = [
        ...new Set(
          eventrooms
            .map((er) => Number(er.room_name))
            .filter((n) => !Number.isNaN(n)),
        ),
      ];
      if (roomIds.length > 0) {
        rooms = await this.prisma.rooms.findMany({
          where: { rooms_id: { in: roomIds } },
          select: { rooms_id: true, room_name: true, room_capacity: true },
        });
      }
      for (const er of eventrooms) {
        const caps = splitCsv(er.room_cap);
        const prices = splitCsv(er.room_price);
        const roomRecord = (rooms as { rooms_id: number; room_capacity?: string | null }[]).find(
          (r) => String(r.rooms_id) === er.room_name,
        );
        occupancy[String(er.room_name)] = maxOccupancy([...caps, ...splitCsv(roomRecord?.room_capacity)]);
        caps.forEach((cap, i) => {
          const o = parseCapacity(cap);
          rates.push({
            room_id: String(er.room_name),
            cap,
            adults: o?.adults ?? 0,
            children: o?.children ?? 0,
            rate: parseFloat((prices[i] ?? '0').replace(/[^0-9.]/g, '')) || 0,
          });
        });
      }
      rooms = rooms.map((r) => ({ rooms_id: r.rooms_id, room_name: r.room_name }));
    }

    // Every payment, refund and overpayment recorded against this booking
    const transactions = (
      await this.prisma.booking_transactions.findMany({
        where: { booking_id: bookingId },
        orderBy: { id: 'asc' },
      })
    ).map((t) => ({ ...t, id: Number(t.id), schedule_id: t.schedule_id === null ? null : Number(t.schedule_id), amount: Number(t.amount) }));
    const refundDue = round2(
      Math.max(0, transactions.filter((t) => t.type === 'refund_due').reduce((sum, t) => sum + t.amount, 0)),
    );

    const changeRequests = (
      await this.prisma.booking_change_requests.findMany({
        where: { booking_id: bookingId },
        orderBy: { created_at: 'desc' },
      })
    ).map((r) => ({ ...r, id: Number(r.id) }));

    return { booking, paymentSchedule, rooms, rates, occupancy, transactions, refundDue, changeRequests };
  }

  // Records one line of the booking's money history (payment, refund, amount owed back)
  private recordTransaction(
    db: Db,
    data: {
      booking_id: number;
      schedule_id?: bigint | null;
      type: 'deposit' | 'installment' | 'refund' | 'refund_due';
      status?: 'succeeded' | 'refund_due' | 'failed';
      amount: number;
      stripe_charge_id?: string | null;
      stripe_refund_id?: string | null;
      note?: string | null;
    },
  ) {
    return db.booking_transactions.create({
      data: {
        booking_id: data.booking_id,
        schedule_id: data.schedule_id ?? null,
        type: data.type,
        status: data.status ?? 'succeeded',
        amount: data.amount,
        stripe_charge_id: data.stripe_charge_id ?? null,
        stripe_refund_id: data.stripe_refund_id ?? null,
        note: data.note ?? null,
      },
    });
  }

  // Admin "Edit Booking".
  //  - Stay dates are fixed for the booking: they are validated, never changed, and
  //    the nights are always counted from the saved dates.
  //  - Room price = per-person rate x billable guests x nights x NUMBER OF ROOMS.
  //  - The rate follows the occupancy: if a capacity option of this room matches the
  //    new adults/children, that option's rate is used.
  //  - Adults / total guests may not exceed what the room can host.
  //  - What was already paid (deposit + paid installments) is subtracted from the new
  //    total; if the guest has paid MORE than the new total, the difference is recorded
  //    as a refund due instead of silently disappearing.
  async updateBooking(bookingId: number, dto: UpdateBookingDto) {
    const booking = await this.prisma.bookings.findUnique({
      where: { booking_id: bookingId },
    });
    if (!booking) throw new NotFoundException('Reservation not found.');
    if (booking.status === 'cancelled') {
      throw new BadRequestException('This booking has been cancelled and can no longer be edited.');
    }

    const bookingroom = await this.prisma.bookingrooms.findFirst({
      where: { booking_id: String(bookingId) },
    });

    // ---- dates -------------------------------------------------------------
    let nights = 1;
    if (bookingroom) {
      const stayCheckin = toIsoDay(bookingroom.checkin);
      const stayCheckout = toIsoDay(bookingroom.checkout);
      if (!stayCheckin || !stayCheckout) {
        throw new BadRequestException('The check-in / check-out dates saved on this booking are not valid dates.');
      }
      nights = nightsBetween(stayCheckin, stayCheckout);
      if (nights < 1) {
        throw new BadRequestException('Check-out must be after check-in.');
      }
      for (const [label, submitted, saved] of [
        ['Check-in', dto.checkin, stayCheckin],
        ['Check-out', dto.checkout, stayCheckout],
      ] as const) {
        if (submitted === undefined || submitted === null || submitted === '') continue;
        const day = toIsoDay(submitted);
        if (!day) throw new BadRequestException(`${label} date is not a valid date.`);
        if (day !== saved) {
          throw new BadRequestException(`${label} date cannot be changed — the stay dates are fixed for this booking.`);
        }
      }
    }

    // ---- guests / room -----------------------------------------------------
    const adults = dto.adults ?? 0;
    const children = dto.children ?? 0;
    const childAge = (dto.child_age ?? '').trim();
    const qty = Math.max(1, dto.room_count ?? 1);
    if (adults + children < 1) {
      throw new BadRequestException('At least one guest is required.');
    }

    const eventId = bookingroom?.event_id ? Number(bookingroom.event_id) : null;
    const eventrooms = eventId
      ? await this.prisma.eventrooms.findMany({ where: { event_id: String(eventId) } })
      : [];
    const eventroom = eventrooms.find((er) => er.room_name === dto.room_id);
    const roomRecord = Number.isNaN(Number(dto.room_id))
      ? null
      : await this.prisma.rooms.findUnique({ where: { rooms_id: Number(dto.room_id) } });
    const roomLabel = roomRecord?.room_name ?? 'This room';

    const eventCaps = splitCsv(eventroom?.room_cap);
    const { maxAdults, maxPeople } = maxOccupancy([...eventCaps, ...splitCsv(roomRecord?.room_capacity)]);
    if (maxAdults > 0 && adults > maxAdults) {
      throw new BadRequestException(`${roomLabel} allows a maximum of ${maxAdults} adult${maxAdults === 1 ? '' : 's'}.`);
    }
    if (maxPeople > 0 && adults + children > maxPeople) {
      throw new BadRequestException(`${roomLabel} allows a maximum of ${maxPeople} guests (adults and children together).`);
    }

    // ---- rate (follows the occupancy) -----------------------------------------
    const ages = childAge.split(',').map((s) => s.trim()).filter(Boolean);
    let eligibleForRoom = adults;
    for (const age of ages) {
      if (parseInt(age, 10) >= 3) eligibleForRoom++;
    }
    eligibleForRoom = Math.max(1, eligibleForRoom);

    let baseRate = Number(bookingroom?.room_actual_price ?? 0);
    let roomCap = bookingroom?.room_cap ?? null;
    if (eventroom) {
      const prices = splitCsv(eventroom.room_price);
      const rateAt = (i: number) => parseFloat((prices[i] ?? '0').replace(/[^0-9.]/g, '')) || 0;
      const exact = eventCaps.findIndex((c) => {
        const o = parseCapacity(c);
        return !!o && o.adults === adults && o.children === children;
      });
      const current = eventCaps.findIndex((c) => sameCapacity(c, bookingroom?.room_cap));
      const sameAdults = eventCaps.findIndex((c) => parseCapacity(c)?.adults === adults);
      const idx = exact >= 0 ? exact : current >= 0 ? current : sameAdults >= 0 ? sameAdults : 0;
      if (eventCaps[idx] !== undefined && rateAt(idx) > 0) {
        baseRate = rateAt(idx);
        roomCap = eventCaps[idx];
      }
    }

    if (dto.rate_per_person !== undefined && dto.rate_per_person > 0) {
      baseRate = dto.rate_per_person; // the admin typed a rate: honour it (the form shows it)
    }

    // ---- availability (rooms already held by OTHER bookings) ---------------------
    if (eventId && eventroom && roomCap) {
      const stock = await computeStock(this.prisma, eventId, eventrooms, bookingId);
      const s = stock.get(stockKey(dto.room_id, roomCap));
      if (s && s.available !== null && qty > s.available) {
        throw new BadRequestException(
          s.available === 0
            ? `${roomLabel} is fully booked for this option.`
            : `Only ${s.available} room${s.available === 1 ? ' is' : 's are'} available for this option.`,
        );
      }
    }

    // ---- amounts -------------------------------------------------------------
    const newRoomPrice = round2(baseRate * eligibleForRoom * nights * qty);

    let newTransportTotal = 0;
    if (dto.transport_enabled) {
      let perPersonRate = Number(dto.transport_per_person ?? 0);
      if (perPersonRate <= 0 && bookingroom?.event_id) {
        const event = await this.prisma.events.findUnique({
          where: { event_id: Number(bookingroom.event_id) },
        });
        perPersonRate = Number(event?.transport_price ?? 0);
      }
      // same people count as the guest checkout / server pricing: guests x rooms
      newTransportTotal = round2(perPersonRate * Math.max(1, adults + children) * qty);
    }

    const newTotal = round2(newRoomPrice + newTransportTotal);

    const paidSchedules = await this.prisma.payment_schedules.findMany({
      where: { booking_id: bookingId, status: 'paid' },
    });
    const depositPaid = Number(booking.total_amount_after_percent ?? 0);
    const alreadyPaid = round2(depositPaid + paidSchedules.reduce((sum, p) => sum + Number(p.amount), 0));
    const remaining = round2(newTotal - alreadyPaid);
    const newBalance = Math.max(0, remaining);
    const overpaid = Math.max(0, -remaining);

    await this.prisma.$transaction(async (tx) => {
      await tx.bookings.update({
        where: { booking_id: bookingId },
        data: {
          total_card_amount: String(newTotal),
          transport_total: newTransportTotal,
          balance: String(newBalance),
        },
      });

      if (bookingroom) {
        await tx.bookingrooms.updateMany({
          where: { booking_id: String(bookingId) },
          data: {
            room_id: dto.room_id,
            quantity: String(qty),
            room_price: String(newRoomPrice),
            room_actual_price: baseRate,
            room_cap: roomCap ?? undefined,
            adults: String(adults),
            children: String(children),
            child_age: childAge,
            rooms: String(qty),
          },
        });
      }

      // Remove only pending/paused schedules and rebuild from submitted data —
      // already-paid installments are untouched, exactly like the old system.
      const oldBalance = Number(booking.balance ?? 0);
      await tx.payment_schedules.deleteMany({
        where: { booking_id: bookingId, status: { in: ['pending', 'paused'] } },
      });

      const validSchedules = (dto.schedules ?? []).filter((s) => s.amount && s.due_date);
      if (newBalance > 0 && validSchedules.length > 0) {
        // If the submitted installment amounts sum to the OLD balance, scale
        // them proportionally to the new balance; otherwise take them as-is.
        const submittedSum = validSchedules.reduce((sum, s) => sum + Number(s.amount), 0);
        const scaleFactor =
          submittedSum > 0 && Math.abs(submittedSum - oldBalance) < 1 ? newBalance / submittedSum : 1;

        let runningTotal = 0;
        const last = validSchedules.length - 1;
        const toCreate = validSchedules.map((s, i) => {
          let scaled: number;
          if (i === last) {
            scaled = round2(newBalance - runningTotal);
          } else {
            scaled = round2(Number(s.amount) * scaleFactor);
            runningTotal += scaled;
          }
          return {
            booking_id: BigInt(bookingId),
            user_id: BigInt(booking.user_id ?? '0'),
            installment_number: paidSchedules.length + i + 1,
            amount: scaled,
            due_date: new Date(s.due_date),
            status: 'pending',
          };
        });
        await tx.payment_schedules.createMany({ data: toCreate });
      }

      // Keep the refund-due total equal to what the guest has over-paid right now
      const existing = await tx.booking_transactions.findMany({
        where: { booking_id: bookingId, type: 'refund_due' },
      });
      const alreadyDue = round2(existing.reduce((sum, t) => sum + Number(t.amount), 0));
      const delta = round2(overpaid - alreadyDue);
      if (delta !== 0) {
        await this.recordTransaction(tx, {
          booking_id: bookingId,
          type: 'refund_due',
          status: 'refund_due',
          amount: delta,
          note:
            delta > 0
              ? 'Booking was edited and the new total is lower than the amount already paid'
              : 'Booking was edited — refund due reduced',
        });
      }
    });

    return this.getReservationDetail(bookingId);
  }

  // Cancels a booking. Its rooms go straight back into the event's inventory (stock is
  // counted from active bookings only). With `refund`, everything the guest paid is
  // refunded through Stripe where a charge id is on record; anything that cannot be
  // refunded automatically (older bookings, Stripe error) is recorded as a refund due.
  async cancelBooking(bookingId: number, dto: CancelBookingDto) {
    const booking = await this.prisma.bookings.findUnique({ where: { booking_id: bookingId } });
    if (!booking) throw new NotFoundException('Reservation not found.');
    if (booking.status === 'cancelled') {
      throw new BadRequestException('This booking is already cancelled.');
    }

    const txns = await this.prisma.booking_transactions.findMany({ where: { booking_id: bookingId } });
    const charges = txns.filter((t) => (t.type === 'deposit' || t.type === 'installment') && t.status === 'succeeded');
    const refundedChargeIds = new Set(
      txns.filter((t) => t.type === 'refund' && t.status === 'succeeded' && t.stripe_charge_id).map((t) => t.stripe_charge_id),
    );
    const alreadyDue = round2(txns.filter((t) => t.type === 'refund_due').reduce((sum, t) => sum + Number(t.amount), 0));

    await this.prisma.$transaction(async (tx) => {
      await tx.bookings.update({
        where: { booking_id: bookingId },
        data: {
          status: 'cancelled',
          cancelled_at: new Date(),
          cancel_reason: dto.reason ?? null,
        },
      });
      await tx.payment_schedules.updateMany({
        where: { booking_id: bookingId, status: { in: ['pending', 'paused'] } },
        data: { status: 'cancelled' },
      });
    });

    if (dto.refund) {
      let manualAmount = 0;
      for (const charge of charges) {
        const amount = Number(charge.amount);
        if (charge.stripe_charge_id && refundedChargeIds.has(charge.stripe_charge_id)) continue;
        if (!charge.stripe_charge_id) {
          manualAmount += amount; // no Stripe charge on record (older booking) — refund by hand
          continue;
        }
        try {
          const refund = await this.stripe.refunds.create({ charge: charge.stripe_charge_id });
          await this.recordTransaction(this.prisma, {
            booking_id: bookingId,
            schedule_id: charge.schedule_id,
            type: 'refund',
            amount,
            stripe_charge_id: charge.stripe_charge_id,
            stripe_refund_id: refund.id,
            note: `Refund of the ${charge.type} because the booking was cancelled`,
          });
        } catch (err) {
          manualAmount += amount;
          await this.recordTransaction(this.prisma, {
            booking_id: bookingId,
            type: 'refund_due',
            status: 'failed',
            amount: 0,
            stripe_charge_id: charge.stripe_charge_id,
            note: `Stripe refund failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          });
        }
      }
      // Whatever was owed back before (overpayment) is now part of the full refund — clear it,
      // then record only what still has to be refunded by hand.
      const stillDue = round2(manualAmount);
      const delta = round2(stillDue - alreadyDue);
      if (delta !== 0) {
        await this.recordTransaction(this.prisma, {
          booking_id: bookingId,
          type: 'refund_due',
          status: 'refund_due',
          amount: delta,
          note: stillDue > 0 ? 'Refund to be paid manually (no Stripe charge on record, or the refund failed)' : 'Refund completed',
        });
      }
    }

    return this.getReservationDetail(bookingId);
  }

  // Shared by sendBookingUpdateEmail and getInvoicePdf — builds the exact
  // same InvoiceData shape from the booking's current live state (room/hotel
  // names id-resolved per the shared-table convention established
  // elsewhere in this codebase).
  private async buildInvoiceData(bookingId: number) {
    const { booking, paymentSchedule } = await this.getReservationDetail(bookingId);
    const bookingrooms = await this.prisma.bookingrooms.findMany({
      where: { booking_id: String(bookingId) },
    });

    const roomIds = [
      ...new Set(
        bookingrooms.map((br) => Number(br.room_id)).filter((n) => !Number.isNaN(n)),
      ),
    ];
    const roomRecords = roomIds.length
      ? await this.prisma.rooms.findMany({ where: { rooms_id: { in: roomIds } } })
      : [];
    const roomNameById = new Map(roomRecords.map((r) => [r.rooms_id, r.room_name]));

    const guestCheckin = bookingrooms[0]?.checkin ?? undefined;
    const guestCheckout = bookingrooms[0]?.checkout ?? undefined;

    const rooms = bookingrooms.map((br) => {
      const qty = Math.max(1, Number(br.quantity ?? 1));
      const total = Number(br.room_price ?? 0);
      return {
        room_name: roomNameById.get(Number(br.room_id)) ?? '-',
        room_cap: br.room_cap ?? '-',
        adults: Number(br.adults ?? 0),
        children: Number(br.children ?? 0),
        quantity: qty,
        unit_price: Math.round((total / qty) * 100) / 100,
        total,
      };
    });

    return {
      booking,
      guestCheckin,
      guestCheckout,
      invoiceData: {
        invoiceNumber: `KT-${String(booking.booking_id).padStart(6, '0')}`,
        bookingDate: new Date().toLocaleDateString(),
        guestName: booking.guest_name ?? 'Guest',
        guestEmail: booking.guest_email,
        guestPhone: booking.guest_phone ?? '',
        eventName: booking.event_name ?? '',
        hotelName: booking.hotel_name ?? '',
        checkIn: booking.check_in ?? '',
        checkOut: booking.check_out ?? '',
        guestCheckIn: guestCheckin ?? undefined,
        guestCheckOut: guestCheckout ?? undefined,
        rooms,
        transportTotal: Number(booking.transport_total ?? 0),
        grandTotal: Number(booking.total_card_amount ?? 0),
        depositPaid: Number(booking.amount_paid ?? booking.total_amount_after_percent ?? 0),
        balance: Number(booking.balance ?? 0),
        schedule: paymentSchedule.map((s) => ({
          installmentNumber: s.installment_number,
          amount: Number(s.amount),
          dueDate: s.due_date.toLocaleDateString(),
          status: s.status,
        })),
        accessCode: booking.access_code,
        myBookingUrl: `${this.config.get<string>('WEB_APP_URL')}/my-booking?code=${booking.access_code}`,
      },
    };
  }

  // Re-sends the guest a notification + freshly regenerated invoice PDF
  // after an admin edits their booking — mirrors
  // ClientController::sendBookingUpdateEmail() exactly.
  async sendBookingUpdateEmail(bookingId: number) {
    const { booking, guestCheckin, guestCheckout, invoiceData } =
      await this.buildInvoiceData(bookingId);

    await this.mail.sendBookingUpdate({
      guestEmail: booking.guest_email,
      guestName: booking.guest_name ?? 'Guest',
      accessCode: booking.access_code,
      eventName: booking.event_name ?? undefined,
      checkin: guestCheckin ? new Date(guestCheckin).toLocaleDateString() : undefined,
      checkout: guestCheckout ? new Date(guestCheckout).toLocaleDateString() : undefined,
      invoiceData,
    });

    return { sent: true, guestEmail: booking.guest_email };
  }

  // On-demand invoice PDF for the Reservation Detail page's "Download
  // Invoice" button — same data as the email attachment, just returned
  // directly instead of mailed.
  async getInvoicePdf(bookingId: number) {
    const { booking, invoiceData } = await this.buildInvoiceData(bookingId);
    const pdf = await generateInvoicePdf(invoiceData);
    return { pdf, filename: `invoice-${(booking.access_code ?? String(bookingId)).toUpperCase()}.pdf` };
  }

  // The guest self-booking flow: resolve pricing server-side (never trust a
  // client-submitted total — the old system's tamper bug), charge the
  // deposit via Stripe, then persist everything in one DB transaction. If
  // the DB writes fail after the charge succeeded, we refund immediately
  // instead of leaving the guest charged with no booking (the old system's
  // other bug — charge-then-write with no rollback).
  async createGuestBooking(dto: CreateBookingDto) {
    if (!dto.terms_accepted) {
      throw new BadRequestException(
        'You must accept the terms and conditions.',
      );
    }

    const event = await this.prisma.events.findFirst({
      where: { random: dto.event_code },
    });
    if (!event) throw new NotFoundException('Invalid event code.');

    // `events.hotel_name` holds a hotel id (legacy column naming) — resolve
    // by id first, falling back to a literal name match for older data.
    const hotel = event.hotel_name
      ? ((!Number.isNaN(Number(event.hotel_name))
          ? await this.prisma.hotels.findUnique({ where: { hotel_id: Number(event.hotel_name) } })
          : null) ?? (await this.prisma.hotels.findFirst({ where: { hotel_name: event.hotel_name } })))
      : null;

    if (isEventClosed(event.check_out)) {
      throw new BadRequestException('Bookings for this event are closed — the event has already ended.');
    }

    const eventStart = toIsoDay(event.check_in);
    const eventEnd = toIsoDay(event.check_out);
    const today = todayIso();
    const eventrooms = await this.prisma.eventrooms.findMany({
      where: { event_id: String(event.event_id) },
    });

    const resolvedRooms = dto.rooms.map((line) => {
      const checkin = toIsoDay(line.checkin);
      const checkout = toIsoDay(line.checkout);
      if (!checkin || !checkout) {
        throw new BadRequestException('Check-in / check-out must be valid dates.');
      }
      if (checkout <= checkin) {
        throw new BadRequestException('Check-out must be after check-in.');
      }
      if ((eventStart && checkin < eventStart) || (eventEnd && checkout > eventEnd)) {
        throw new BadRequestException(
          `Selected dates must fall within the event's dates (${event.check_in} - ${event.check_out}).`,
        );
      }
      if (checkin < today) {
        throw new BadRequestException('Check-in date cannot be in the past.');
      }

      const eventroom = eventrooms.find((r) => r.room_name === line.room_name);
      const children = line.children ?? 0;
      const fits = fitsCapacity(line.room_cap, line.adults, children);
      if (fits === false) {
        throw new BadRequestException(
          `The "${capacityLabel(line.room_cap)}" option cannot host ${line.adults} adult${line.adults === 1 ? '' : 's'}` +
            `${children ? ` and ${children} child${children === 1 ? '' : 'ren'}` : ''}. Please choose a room option that fits your party.`,
        );
      }
      const allowed = allowedCapacities(splitCsv(eventroom?.room_cap), line.adults, children);
      if (fits === true && !allowed.some((c) => sameCapacity(c, line.room_cap))) {
        throw new BadRequestException(
          `The "${capacityLabel(line.room_cap)}" option is for a larger party. Please choose ` +
            `${allowed.map((c) => `"${capacityLabel(c)}"`).join(' or ')} for ${line.adults} adult${line.adults === 1 ? '' : 's'}` +
            `${children ? ` and ${children} child${children === 1 ? '' : 'ren'}` : ''}.`,
        );
      }

      const baseRate = resolveRoomRate(eventroom, line.room_cap);
      return resolveRoomLine(line, baseRate);
    });

    // Inventory: refuse BEFORE charging the card if the requested rooms are not available
    const stockBefore = await computeStock(this.prisma, event.event_id, eventrooms);
    this.assertStock(stockBefore, resolvedRooms);

    // `line.room_name` (and eventrooms.room_name) is really a rooms_id
    // (legacy column naming) — resolve the real room name for the invoice.
    const roomIds = [...new Set(resolvedRooms.map((r) => Number(r.room_name)).filter((n) => !Number.isNaN(n)))];
    const roomRecords = roomIds.length
      ? await this.prisma.rooms.findMany({ where: { rooms_id: { in: roomIds } } })
      : [];
    const roomNameById = new Map(roomRecords.map((r) => [r.rooms_id, r.room_name]));

    const roomsTotal = resolvedRooms.reduce((sum, r) => sum + r.room_total, 0);
    const transportTotal =
      event.transport_enabled && dto.transport_opt_in && event.transport_price
        ? Number(event.transport_price) * totalPeopleForTransport(dto.rooms)
        : 0;
    const grandTotal = Math.round((roomsTotal + transportTotal) * 100) / 100;
    const depositDue = calculateDeposit(
      grandTotal,
      Number(event.deposit_amount),
      event.deposit_type,
    );
    const balance = Math.round((grandTotal - depositDue) * 100) / 100;

    let charge: Stripe.Charge;
    try {
      const customer = await this.stripe.customers.create({
        email: dto.billing.email,
        source: dto.stripe_token,
      });
      charge = await this.stripe.charges.create({
        amount: Math.round(depositDue * 100),
        currency: 'usd',
        customer: customer.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed.';
      throw new BadRequestException(message);
    }

    let bookingResult: {
      booking_id: number;
      access_code: string;
      grand_total: number;
      deposit_paid: number;
      balance: number;
    };
    try {
      bookingResult = await this.prisma.$transaction(async (tx) => {
        // Two guests booking the last room at the same moment: lock this event's room rows,
        // then count again, so only one of them gets it.
        await tx.$queryRaw`SELECT eventroom_id FROM eventrooms WHERE event_id = ${String(event.event_id)} FOR UPDATE`;
        this.assertStock(await computeStock(tx, event.event_id, eventrooms), resolvedRooms);

        const accessCode = await this.generateUniqueAccessCode(tx);

        // Every guest booking gets its OWN guest account. It is never attached to an account that
        // already exists (a client, an admin, or this guest's previous booking) — if the e-mail is
        // already registered, this booking's account gets a unique alias address instead.
        // The guest's real name, e-mail and phone are stored on the booking itself.
        const guestName = `${dto.billing.first_name} ${dto.billing.last_name}`.trim();
        const emailTaken = await tx.users.findUnique({
          where: { email: dto.billing.email },
          select: { id: true },
        });
        const [local, domain] = dto.billing.email.split('@');
        const accountEmail = emailTaken ? `${local}+kt${accessCode.toLowerCase()}@${domain}` : dto.billing.email;
        const user = await tx.users.create({
          data: {
            name: guestName,
            email: accountEmail,
            role: 5,
            password: await bcrypt.hash(randomBytes(16).toString('hex'), 10),
            client_phone: dto.billing.phone,
            client_adsress: dto.billing.street_1,
            customer_id: charge.customer as string,
            status: 'active',
            created_at: new Date(),
            updated_at: new Date(),
          },
        });

        const booking = await tx.bookings.create({
          data: {
            user_id: String(user.id),
            guest_name: guestName,
            guest_email: dto.billing.email,
            guest_phone: dto.billing.phone,
            comments: dto.comments?.trim() ? dto.comments.trim() : null,
            access_code: accessCode,
            total_card_amount: String(grandTotal),
            total_amount_after_percent: String(depositDue),
            balance: String(balance),
            transport_total: transportTotal,
            billing_City: dto.billing.city,
            billing_State: dto.billing.state,
            billing_Postcode: dto.billing.postcode,
            billing_country: dto.billing.country,
            Street_2: dto.billing.street_2,
            source: 'self_booking',
          },
        });

        await tx.bookingrooms.createMany({
          data: resolvedRooms.map((r) => ({
            user_id: String(user.id),
            booking_id: String(booking.booking_id),
            hotel_name: event.hotel_name,
            hotel_location: hotel?.hotel_location ?? null,
            event_id: String(event.event_id),
            room_id: r.room_name, // eventrooms.room_name (and this) actually holds the rooms_id
            quantity: String(r.quantity),
            room_cap: r.room_cap,
            room_price: String(r.room_total),
            room_actual_price: r.base_rate,
            checkin: r.checkin,
            checkout: r.checkout,
            adults: String(r.adults),
            children: String(r.children ?? 0),
            child_age: r.child_age ?? '',
            rooms: String(r.quantity),
          })),
        });

        await this.recordTransaction(tx, {
          booking_id: booking.booking_id,
          type: 'deposit',
          amount: depositDue,
          stripe_charge_id: charge.id,
          note: 'Deposit charged at booking',
        });

        if (balance > 0) {
          const schedules = await tx.event_payment_schedules.findMany({
            where: { event_id: event.event_id },
            orderBy: { installment_number: 'asc' },
          });
          if (schedules.length > 0) {
            // Percent installments are a share of the grand total (like the deposit); they add up to the balance
            const amounts = buildInstallmentAmounts(schedules, balance, grandTotal);
            await tx.payment_schedules.createMany({
              data: schedules.map((s, i) => ({
                booking_id: BigInt(booking.booking_id),
                user_id: user.id,
                installment_number: s.installment_number,
                amount: amounts[i],
                due_date: s.due_date,
                status: 'pending',
              })),
            });
          }
        }

        return {
          booking_id: booking.booking_id,
          access_code: accessCode,
          grand_total: grandTotal,
          deposit_paid: depositDue,
          balance,
        };
      });
    } catch (err) {
      await this.stripe.refunds.create({ charge: charge.id });
      if (err instanceof BadRequestException) {
        throw new BadRequestException(`${err.message} Your payment was refunded.`);
      }
      throw new BadRequestException(
        'We were unable to save your reservation, so your payment was refunded. Please try again.',
      );
    }

    // The confirmation e-mail (with its PDF) is sent in the background: the guest gets the
    // confirmation page straight away instead of waiting on the mail server.
    void (async () => {
    try {
      const schedules = await this.prisma.payment_schedules.findMany({
        where: { booking_id: bookingResult.booking_id },
        orderBy: { installment_number: 'asc' },
      });
      await this.mail.sendBookingConfirmation({
        guestEmail: dto.billing.email,
        guestName: `${dto.billing.first_name} ${dto.billing.last_name}`,
        guestPhone: dto.billing.phone,
        accessCode: bookingResult.access_code,
        invoiceData: {
          invoiceNumber: `KT-${String(bookingResult.booking_id).padStart(6, '0')}`,
          bookingDate: new Date().toLocaleDateString(),
          guestName: `${dto.billing.first_name} ${dto.billing.last_name}`,
          guestEmail: dto.billing.email,
          guestPhone: dto.billing.phone,
          eventName: event.event_name ?? '',
          hotelName: hotel?.hotel_name ?? event.hotel_name ?? '',
          checkIn: event.check_in ?? '',
          checkOut: event.check_out ?? '',
          guestCheckIn: resolvedRooms[0]?.checkin,
          guestCheckOut: resolvedRooms[0]?.checkout,
          rooms: resolvedRooms.map((r) => ({
            room_name: roomNameById.get(Number(r.room_name)) ?? r.room_name,
            room_cap: r.room_cap,
            adults: r.adults,
            children: r.children ?? 0,
            quantity: r.quantity,
            // per room for the whole stay — same as the invoice from My Booking / the dashboard
            unit_price: Math.round((r.room_total / Math.max(1, r.quantity)) * 100) / 100,
            total: r.room_total,
          })),
          transportTotal,
          grandTotal: bookingResult.grand_total,
          depositPaid: bookingResult.deposit_paid,
          balance: bookingResult.balance,
          schedule: schedules.map((s) => ({
            installmentNumber: s.installment_number,
            amount: Number(s.amount),
            dueDate: s.due_date.toLocaleDateString(),
            status: s.status,
          })),
          accessCode: bookingResult.access_code,
          myBookingUrl: `${this.config.get<string>('WEB_APP_URL')}/my-booking?code=${bookingResult.access_code}`,
        },
      });
    } catch (err) {
      // Confirmation email is best-effort — the booking itself already
      // succeeded and must still be returned to the guest.
    }
    })();

    return bookingResult;
  }

  // Guest pays a single upcoming installment from their "My Booking" page.
  // Scoped by the booking's own access_code (these are public, unauthenticated
  // endpoints) so a guest can only ever pay their own booking's schedule.
  async payInstallment(dto: PayInstallmentDto) {
    const booking = await this.prisma.bookings.findUnique({
      where: { access_code: dto.access_code },
    });
    if (!booking) throw new NotFoundException('Invalid booking access code.');

    if (booking.status === 'cancelled') {
      throw new BadRequestException('This booking has been cancelled.');
    }

    if (booking.payment_paused) {
      throw new BadRequestException(
        'Payments are currently paused on this booking. Please contact the admin team.',
      );
    }

    const schedule = await this.prisma.payment_schedules.findUnique({
      where: { id: BigInt(dto.schedule_id) },
    });
    if (!schedule || schedule.booking_id !== BigInt(booking.booking_id)) {
      throw new NotFoundException('Installment not found for this booking.');
    }
    if (schedule.status === 'paid') {
      throw new BadRequestException('This installment has already been paid.');
    }

    // Claim the installment before charging: if the guest refreshes / double-submits while
    // the first payment is still running, the second request finds it already claimed and
    // is refused instead of charging the card twice.
    const claim = await this.prisma.payment_schedules.updateMany({
      where: { id: schedule.id, status: { in: ['pending', 'failed'] } },
      data: { status: 'processing' },
    });
    if (claim.count === 0) {
      throw new BadRequestException('This installment is already being paid. Please refresh in a moment.');
    }

    let charge: Stripe.Charge;
    try {
      charge = await this.stripe.charges.create({
        amount: Math.round(Number(schedule.amount) * 100),
        currency: 'usd',
        source: dto.stripe_token,
        description: `KT Travel booking ${booking.access_code} — installment ${schedule.installment_number}`,
      });
    } catch (err) {
      await this.prisma.payment_schedules.update({ where: { id: schedule.id }, data: { status: schedule.status } });
      const message = err instanceof Error ? err.message : 'Payment failed.';
      throw new BadRequestException(message);
    }

    const paidAmount = Number(schedule.amount);
    const balanceBefore = Number(booking.balance ?? 0);
    const newBalance = Math.max(0, round2(balanceBefore - paidAmount));
    // The installment is larger than what was still owed: the extra is an overpayment
    const excess = Math.max(0, round2(paidAmount - balanceBefore));

    const updatedSchedule = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment_schedules.update({
        where: { id: schedule.id },
        data: { status: 'paid', paid_at: new Date(), stripe_charge_id: charge.id },
      });
      await tx.bookings.update({
        where: { booking_id: booking.booking_id },
        data: { balance: String(newBalance) },
      });
      await this.recordTransaction(tx, {
        booking_id: booking.booking_id,
        schedule_id: schedule.id,
        type: 'installment',
        amount: paidAmount,
        stripe_charge_id: charge.id,
        note: `Installment ${schedule.installment_number} paid`,
      });
      if (excess > 0) {
        await this.recordTransaction(tx, {
          booking_id: booking.booking_id,
          schedule_id: schedule.id,
          type: 'refund_due',
          status: 'refund_due',
          amount: excess,
          note: `Installment ${schedule.installment_number} was more than the remaining balance — overpayment`,
        });
      }
      return updated;
    });

    // Receipt e-mail in the background — the payment itself already succeeded.
    void (async () => {
      try {
        const user = booking.user_id
          ? await this.prisma.users.findUnique({ where: { id: BigInt(booking.user_id) } })
          : null;
        const receiptEmail = booking.guest_email ?? user?.email;
        if (receiptEmail) {
          await this.mail.sendPaymentReceipt({
            guestEmail: receiptEmail,
            guestName: booking.guest_name ?? user?.name ?? 'Guest',
            accessCode: booking.access_code as string,
            amount: Number(schedule.amount),
            newBalance,
          });
        }
      } catch {
        // best-effort
      }
    })();

    return { schedule: updatedSchedule, balance: newBalance };
  }

  // Runs daily — emails guests whose next installment is due tomorrow.
  // (See KT_Travel_System_Guide.md Step 8: reminders go out 1 day before
  // each installment's due date.)
  @Cron('0 9 * * *')
  async sendInstallmentReminders() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const start = new Date(tomorrow.setHours(0, 0, 0, 0));
    const end = new Date(tomorrow.setHours(23, 59, 59, 999));

    const dueSchedules = await this.prisma.payment_schedules.findMany({
      where: { status: 'pending', due_date: { gte: start, lte: end } },
    });

    for (const schedule of dueSchedules) {
      const booking = await this.prisma.bookings.findUnique({
        where: { booking_id: Number(schedule.booking_id) },
      });
      if (!booking || booking.payment_paused || booking.status === 'cancelled' || !booking.user_id) continue;

      const user = await this.prisma.users.findUnique({
        where: { id: BigInt(booking.user_id) },
      });
      const reminderEmail = booking.guest_email ?? user?.email;
      if (!reminderEmail) continue;

      await this.mail.sendInstallmentReminder({
        guestEmail: reminderEmail,
        guestName: booking.guest_name ?? user?.name ?? 'Guest',
        accessCode: booking.access_code as string,
        installmentNumber: schedule.installment_number,
        amount: Number(schedule.amount),
        dueDate: schedule.due_date.toLocaleDateString(),
        balance: Number(booking.balance ?? 0),
      });
    }
  }

  // Throws if any requested room line needs more rooms than are left (rooms with no
  // stock figure set are not limited).
  private assertStock(
    stock: Map<string, { available: number | null }>,
    lines: { room_name: string; room_cap: string; quantity: number }[],
  ) {
    const wanted = new Map<string, number>();
    for (const line of lines) {
      const key = stockKey(line.room_name, line.room_cap);
      wanted.set(key, (wanted.get(key) ?? 0) + line.quantity);
    }
    for (const [key, qty] of wanted) {
      const available = stock.get(key)?.available;
      if (available === null || available === undefined) continue;
      if (qty > available) {
        throw new BadRequestException(
          available === 0
            ? 'Sorry, this room is sold out.'
            : `Only ${available} room${available === 1 ? ' is' : 's are'} left for this option.`,
        );
      }
    }
  }

  private async generateUniqueAccessCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomBytes(8).toString('hex').toUpperCase().slice(0, 8);
      const exists = await tx.bookings.findUnique({
        where: { access_code: code },
      });
      if (!exists) return code;
    }
    throw new Error('Could not generate a unique booking access code.');
  }
}
