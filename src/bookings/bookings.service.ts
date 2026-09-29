import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { generateInvoicePdf } from '../mail/invoice-pdf.util.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { PayInstallmentDto } from './dto/pay-installment.dto.js';
import { UpdateBookingDto } from './dto/update-booking.dto.js';
import {
  calculateDeposit,
  resolveRoomLine,
  resolveRoomRate,
  totalPeopleForTransport,
} from './booking-pricing.util.js';

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
        guest_name: guest?.name ?? null,
        guest_email: guest?.email ?? null,
        guest_phone: guest?.client_phone ?? null,
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
    return this.getReservationDetail(booking.booking_id);
  }

  async getInvoicePdfByAccessCode(accessCode: string) {
    const booking = await this.prisma.bookings.findUnique({
      where: { access_code: accessCode },
    });
    if (!booking) throw new NotFoundException('Invalid booking access code.');
    return this.getInvoicePdf(booking.booking_id);
  }

  // Emails the admin team a guest's free-text change request — mirrors
  // ClientController::requestChange() exactly (no DB write, just a
  // notification email to the business inbox).
  async requestChange(accessCode: string, message: string) {
    const booking = await this.prisma.bookings.findUnique({
      where: { access_code: accessCode },
    });
    if (!booking) throw new NotFoundException('Invalid booking access code.');

    const guest = booking.user_id
      ? await this.prisma.users.findUnique({ where: { id: BigInt(booking.user_id) } })
      : null;

    await this.mail.sendChangeRequest({
      guestName: guest?.name ?? 'Guest',
      guestEmail: guest?.email ?? 'N/A',
      accessCode,
      message,
    });

    return { sent: true };
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
        bookings.created_at,
        users.name AS guest_name, users.email AS guest_email, users.client_phone AS guest_phone,
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

    let rooms: { rooms_id: number; room_name: string | null }[] = [];
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
          select: { rooms_id: true, room_name: true },
        });
      }
    }

    return { booking, paymentSchedule, rooms };
  }

  // Mirrors ClientController::updateBooking() exactly, including its
  // real quirks: room price is per-person-per-night x eligible occupants x
  // nights — quantity is occupancy only, NOT a price multiplier here (unlike
  // the guest-booking creation flow's resolveRoomLine, which does multiply by
  // quantity — the old system genuinely computes these two flows
  // differently, so this is written standalone rather than reusing
  // resolveRoomLine, to avoid quietly "fixing" a real behavioral difference).
  async updateBooking(bookingId: number, dto: UpdateBookingDto) {
    const booking = await this.prisma.bookings.findUnique({
      where: { booking_id: bookingId },
    });
    if (!booking) throw new NotFoundException('Reservation not found.');

    const alreadyPaid = Number(booking.total_amount_after_percent ?? 0);
    const adults = dto.adults ?? 0;
    const children = dto.children ?? 0;
    const childAge = (dto.child_age ?? '').trim();
    const qty = Math.max(1, dto.room_count ?? 1);

    const nights = Math.max(
      1,
      Math.round(
        (new Date(dto.checkout).getTime() - new Date(dto.checkin).getTime()) /
          86400000,
      ),
    );

    const bookingroom = await this.prisma.bookingrooms.findFirst({
      where: { booking_id: String(bookingId) },
    });
    let baseRate = Number(bookingroom?.room_actual_price ?? 0);

    if (baseRate <= 0 && bookingroom) {
      const eventroom = await this.prisma.eventrooms.findFirst({
        where: {
          event_id: bookingroom.event_id ?? undefined,
          room_name: bookingroom.room_id ?? undefined,
        },
      });
      if (eventroom) {
        const caps = (eventroom.room_cap ?? '').split(',').map((s) => s.trim());
        const prices = (eventroom.room_price ?? '').split(',');
        const idx = caps.indexOf((bookingroom.room_cap ?? '').trim());
        if (idx !== -1) {
          baseRate = parseFloat((prices[idx] ?? '0').replace(/[^0-9.]/g, '')) || 0;
        }
      }
    }

    const ages = childAge.split(',').map((s) => s.trim()).filter(Boolean);
    let eligibleForRoom = adults;
    for (const age of ages) {
      if (parseInt(age, 10) >= 3) eligibleForRoom++;
    }
    eligibleForRoom = Math.max(1, eligibleForRoom);

    const newRoomPrice = baseRate * eligibleForRoom * nights;

    let newTransportTotal = 0;
    if (dto.transport_enabled) {
      let perPersonRate = Number(dto.transport_per_person ?? 0);
      if (perPersonRate <= 0 && bookingroom?.event_id) {
        const event = await this.prisma.events.findUnique({
          where: { event_id: Number(bookingroom.event_id) },
        });
        perPersonRate = Number(event?.transport_price ?? 0);
      }
      newTransportTotal = perPersonRate * Math.max(1, adults + children);
    }

    const newTotal = newRoomPrice + newTransportTotal;
    const newBalance = Math.max(0, newTotal - alreadyPaid);
    const oldBalance = Number(booking.balance ?? 0);

    await this.prisma.bookings.update({
      where: { booking_id: bookingId },
      data: {
        total_card_amount: String(newTotal),
        transport_total: newTransportTotal,
        balance: String(newBalance),
      },
    });

    if (bookingroom) {
      await this.prisma.bookingrooms.updateMany({
        where: { booking_id: String(bookingId) },
        data: {
          room_id: dto.room_id,
          quantity: String(qty),
          room_price: String(newRoomPrice),
          checkin: dto.checkin,
          checkout: dto.checkout,
          adults: String(adults),
          children: String(children),
          child_age: childAge,
          rooms: String(qty),
        },
      });
    }

    // Remove only pending/paused schedules and rebuild from submitted data —
    // already-paid installments are untouched, exactly like the old system.
    await this.prisma.payment_schedules.deleteMany({
      where: { booking_id: bookingId, status: { in: ['pending', 'paused'] } },
    });

    const validSchedules = (dto.schedules ?? []).filter(
      (s) => s.amount && s.due_date,
    );
    if (validSchedules.length > 0) {
      // If the submitted installment amounts sum to the OLD balance, scale
      // them proportionally to the new balance; otherwise take them as-is.
      const submittedSum = validSchedules.reduce((sum, s) => sum + Number(s.amount), 0);
      const scaleFactor =
        submittedSum > 0 && Math.abs(submittedSum - oldBalance) < 1
          ? newBalance / submittedSum
          : 1;

      let runningTotal = 0;
      const last = validSchedules.length - 1;
      const toCreate = validSchedules.map((s, i) => {
        let scaled: number;
        if (i === last) {
          scaled = Math.round((newBalance - runningTotal) * 100) / 100;
        } else {
          scaled = Math.round(Number(s.amount) * scaleFactor * 100) / 100;
          runningTotal += scaled;
        }
        return {
          booking_id: bookingId,
          user_id: BigInt(booking.user_id ?? '0'),
          installment_number: i + 1,
          amount: scaled,
          due_date: new Date(s.due_date),
          status: 'pending',
        };
      });
      await this.prisma.payment_schedules.createMany({ data: toCreate });
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
        depositPaid: Number(booking.total_amount_after_percent ?? 0),
        balance: Number(booking.balance ?? 0),
        schedule: paymentSchedule.map((s) => ({
          installmentNumber: s.installment_number,
          amount: Number(s.amount),
          dueDate: s.due_date.toLocaleDateString(),
          status: s.status,
        })),
        accessCode: booking.access_code,
        myBookingUrl: `${this.config.get<string>('WEB_APP_URL')}/my-booking`,
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

    const eventCheckIn = new Date(event.check_in as string);
    const eventCheckOut = new Date(event.check_out as string);
    const eventrooms = await this.prisma.eventrooms.findMany({
      where: { event_id: String(event.event_id) },
    });

    const resolvedRooms = dto.rooms.map((line) => {
      const checkin = new Date(line.checkin);
      const checkout = new Date(line.checkout);
      if (checkin < eventCheckIn || checkout > eventCheckOut || checkout <= checkin) {
        throw new BadRequestException(
          `Selected dates must fall within the event's dates (${event.check_in} - ${event.check_out}).`,
        );
      }
      const eventroom = eventrooms.find((r) => r.room_name === line.room_name);
      const baseRate = resolveRoomRate(eventroom, line.room_cap);
      return resolveRoomLine(line, baseRate);
    });

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
        let user = await tx.users.findUnique({
          where: { email: dto.billing.email },
        });
        if (!user) {
          user = await tx.users.create({
            data: {
              name: `${dto.billing.first_name} ${dto.billing.last_name}`,
              email: dto.billing.email,
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
        }

        const accessCode = await this.generateUniqueAccessCode(tx);

        const booking = await tx.bookings.create({
          data: {
            user_id: String(user.id),
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
            user_id: String(user!.id),
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

        if (balance > 0) {
          const schedules = await tx.event_payment_schedules.findMany({
            where: { event_id: event.event_id },
            orderBy: { installment_number: 'asc' },
          });
          if (schedules.length > 0) {
            await tx.payment_schedules.createMany({
              data: schedules.map((s) => ({
                booking_id: BigInt(booking.booking_id),
                user_id: user!.id,
                installment_number: s.installment_number,
                amount:
                  s.amount_type === 'percent'
                    ? Math.round(grandTotal * (Number(s.amount) / 100) * 100) / 100
                    : Number(s.amount),
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
      throw new BadRequestException(
        'We were unable to save your reservation, so your payment was refunded. Please try again.',
      );
    }

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
            unit_price: r.base_rate,
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
          myBookingUrl: `${this.config.get<string>('WEB_APP_URL')}/my-booking`,
        },
      });
    } catch (err) {
      // Confirmation email is best-effort — the booking itself already
      // succeeded and must still be returned to the guest.
    }

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

    let charge: Stripe.Charge;
    try {
      charge = await this.stripe.charges.create({
        amount: Math.round(Number(schedule.amount) * 100),
        currency: 'usd',
        source: dto.stripe_token,
        description: `KT Travel booking ${booking.access_code} — installment ${schedule.installment_number}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed.';
      throw new BadRequestException(message);
    }

    const newBalance = Math.max(
      0,
      Math.round((Number(booking.balance ?? 0) - Number(schedule.amount)) * 100) / 100,
    );

    const [updatedSchedule] = await this.prisma.$transaction([
      this.prisma.payment_schedules.update({
        where: { id: schedule.id },
        data: { status: 'paid', paid_at: new Date(), stripe_charge_id: charge.id },
      }),
      this.prisma.bookings.update({
        where: { booking_id: booking.booking_id },
        data: { balance: String(newBalance) },
      }),
    ]);

    try {
      const user = booking.user_id
        ? await this.prisma.users.findUnique({ where: { id: BigInt(booking.user_id) } })
        : null;
      if (user) {
        await this.mail.sendPaymentReceipt({
          guestEmail: user.email,
          guestName: user.name,
          accessCode: booking.access_code as string,
          amount: Number(schedule.amount),
          newBalance,
        });
      }
    } catch {
      // Receipt email is best-effort — the payment itself already succeeded.
    }

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
      if (!booking || booking.payment_paused || !booking.user_id) continue;

      const user = await this.prisma.users.findUnique({
        where: { id: BigInt(booking.user_id) },
      });
      if (!user) continue;

      await this.mail.sendInstallmentReminder({
        guestEmail: user.email,
        guestName: user.name,
        accessCode: booking.access_code as string,
        installmentNumber: schedule.installment_number,
        amount: Number(schedule.amount),
        dueDate: schedule.due_date.toLocaleDateString(),
        balance: Number(booking.balance ?? 0),
      });
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
