import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEventDto, EventRoomDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { computeStock, isEventClosed, stockKey, toIsoDay, todayIso } from '../bookings/booking-rules.util.js';

const CODE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function eventRoomRowsForStock(rows: { room_name: string | null; room_cap: string | null; no_of_rooms: string | null }[]) {
  return rows.map((r) => ({ room_name: r.room_name, room_cap: r.room_cap, no_of_rooms: r.no_of_rooms }));
}

function generateCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

// Mirrors the legacy `eventrooms` row shape: one row per room type, with
// per-capacity values joined into comma-separated strings (see the old
// EventController@saveevent `sorted_data` construction). `room_name` here
// actually holds the room's id (see EventRoomDto's comment).
function buildEventroomRow(eventId: number, room: EventRoomDto) {
  const capacityNames = room.capacities.map((c) => c.capacity_name).join(',');
  const roomCaps = room.capacities.map((c) => c.room_cap).join(',');
  const roomPrices = room.capacities.map((c) => c.room_price).join(',');
  const noOfRoomsPerCapacity = room.capacities.map(() => room.no_of_rooms);
  const sumOfRooms = noOfRoomsPerCapacity.reduce((a, b) => a + b, 0);

  return {
    event_id: String(eventId),
    room_name: room.room_id,
    capacity_name: capacityNames,
    room_cap: roomCaps,
    room_price: roomPrices,
    no_of_rooms: noOfRoomsPerCapacity.join(','),
    sum_of_rooms: String(sumOfRooms),
  };
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  // `events.hotel_name` holds a hotel id (legacy naming), so resolve by id
  // first; fall back to a literal name match for any older/odd data.
  private async resolveHotel(hotelNameOrId: string | null) {
    if (!hotelNameOrId) return null;
    const asId = Number(hotelNameOrId);
    if (!Number.isNaN(asId)) {
      const byId = await this.prisma.hotels.findUnique({ where: { hotel_id: asId } });
      if (byId) return byId;
    }
    return this.prisma.hotels.findFirst({ where: { hotel_name: hotelNameOrId } });
  }

  // `eventrooms.room_name` holds a rooms_id (legacy naming) — same pattern.
  private async resolveRoom(roomNameOrId: string | null) {
    if (!roomNameOrId) return null;
    const asId = Number(roomNameOrId);
    if (!Number.isNaN(asId)) {
      const byId = await this.prisma.rooms.findUnique({ where: { rooms_id: asId } });
      if (byId) return byId;
    }
    return this.prisma.rooms.findFirst({ where: { room_name: roomNameOrId } });
  }

  async findAll() {
    const events = await this.prisma.events.findMany({ orderBy: { event_id: 'desc' } });
    const hotels = await Promise.all(events.map((e) => this.resolveHotel(e.hotel_name)));
    return events.map((e, i) => ({
      ...e,
      hotel_display_name: hotels[i]?.hotel_name ?? e.hotel_name,
      hotel_location: hotels[i]?.hotel_location ?? null,
    }));
  }

  async findOne(id: number) {
    const event = await this.prisma.events.findUnique({
      where: { event_id: id },
    });
    if (!event) throw new NotFoundException('Event not found.');

    const [eventroomRows, paymentSchedules, hotel] = await Promise.all([
      this.prisma.eventrooms.findMany({ where: { event_id: String(id) } }),
      this.prisma.event_payment_schedules.findMany({
        where: { event_id: id },
        orderBy: { installment_number: 'asc' },
      }),
      this.resolveHotel(event.hotel_name),
    ]);

    const eventroomsRaw = await Promise.all(
      eventroomRows.map(async (er) => ({ ...er, room: await this.resolveRoom(er.room_name) })),
    );

    // Resolved for the public guest event-view/room-results pages (hotel's
    // "Featured Amenities" list, and each room's own amenity list) — amenity
    // names/icons aren't sensitive, so resolving them here is safe on a
    // public route and saves the frontend from needing its own (auth-guarded)
    // /amenities call.
    const allAmenityIds = new Set<number>();
    const collectIds = (csv: string | null | undefined) => {
      for (const part of (csv ?? '').split(',')) {
        const n = parseInt(part.trim(), 10);
        if (!Number.isNaN(n)) allAmenityIds.add(n);
      }
    };
    collectIds(hotel?.hotel_amenities);
    for (const er of eventroomsRaw) collectIds(er.room?.room_amenities);

    const amenityRows = allAmenityIds.size
      ? await this.prisma.amenities.findMany({
          where: { amenities_id: { in: [...allAmenityIds] } },
          select: { amenities_id: true, amenities_name: true, amenities_image: true },
        })
      : [];
    const amenityById = new Map(amenityRows.map((a) => [a.amenities_id, a]));
    const resolveAmenityList = (csv: string | null | undefined) =>
      (csv ?? '')
        .split(',')
        .map((s) => amenityById.get(parseInt(s.trim(), 10)))
        .filter((a): a is (typeof amenityRows)[number] => Boolean(a));

    // Rooms still free for every capacity option (null = no stock figure set, i.e. not limited).
    // Aligned with the comma-separated room_cap list so the booking pages can index by position.
    const stock = await computeStock(this.prisma, id, eventRoomRowsForStock(eventroomRows));
    const eventrooms = eventroomsRaw.map((er) => ({
      ...er,
      room: er.room ? { ...er.room, amenities: resolveAmenityList(er.room.room_amenities) } : null,
      availability: (er.room_cap ?? '')
        .split(',')
        .map((cap) => stock.get(stockKey(er.room_name, cap.trim()))?.available ?? null),
    }));

    return {
      ...event,
      hotel_display_name: hotel?.hotel_name ?? event.hotel_name,
      eventrooms,
      paymentSchedules,
      hotel,
      hotelAmenities: resolveAmenityList(hotel?.hotel_amenities),
      // Guest booking page: closed once the event is over; check-in can't be before today
      booking_closed: isEventClosed(event.check_out),
      today: todayIso(),
    };
  }

  async findByCode(code: string) {
    const event = await this.prisma.events.findFirst({
      where: { random: code },
    });
    if (!event) throw new NotFoundException('Invalid event code.');
    return this.findOne(event.event_id);
  }

  // Same rules the admin event form enforces, so a direct API call cannot save an event
  // the booking flow would mishandle.
  private validateEventRules(e: {
    check_in?: string | null;
    check_out?: string | null;
    deposit_type?: string | null;
    deposit_amount?: number | string | null;
    installments?: { amount_type: string; amount: number | string }[];
  }) {
    const start = toIsoDay(e.check_in);
    const end = toIsoDay(e.check_out);
    if (!start || !end) throw new BadRequestException('The event start and end dates must be valid dates.');
    if (end <= start) throw new BadRequestException('The event end date must be after the start date.');

    if (e.installments) {
      if (e.installments.length > 3) {
        throw new BadRequestException('An event can have at most 3 installments.');
      }
      // Percent installments, like a percent deposit, are a share of the booking's total:
      // deposit 30% + installments 50% + 20% = 100%
      const percent = e.installments.filter((i) => i.amount_type === 'percent');
      const depositPercent = e.deposit_type === 'percent' ? Number(e.deposit_amount) || 0 : 0;
      const hasFixed = e.deposit_type !== 'percent' || e.installments.some((i) => i.amount_type === 'fixed');
      const total =
        Math.round((depositPercent + percent.reduce((sum, i) => sum + (Number(i.amount) || 0), 0)) * 100) / 100;
      if (percent.length > 0 && !hasFixed && total !== 100) {
        throw new BadRequestException(
          `The deposit and installments must add up to 100% of the total (currently ${total}%).`,
        );
      }
      if (percent.length > 0 && hasFixed && total >= 100) {
        throw new BadRequestException(
          `The deposit and percent installments already reach ${total}% of the total, leaving nothing for the fixed amounts. Keep them below 100%.`,
        );
      }
    }
  }

  async create(dto: CreateEventDto) {
    if (dto.rooms.length === 0) {
      throw new NotFoundException('Please select at least one room.');
    }
    this.validateEventRules(dto);

    const createdEventId = await this.prisma.$transaction(async (tx) => {
      const event = await tx.events.create({
        data: {
          client_created_by: dto.client_created_by,
          random: generateCode(),
          client_name: dto.client_name,
          client_email: dto.client_email,
          client_phone: dto.client_phone,
          event_name: dto.event_name,
          event_color_code: dto.event_color_code,
          check_in: dto.check_in,
          check_out: dto.check_out,
          hotel_name: dto.hotel_name,
          event_description: dto.event_description,
          event_terms: dto.event_terms,
          event_profile: dto.event_profile ?? '',
          event_cover: dto.event_cover ?? '',
          transport_enabled: dto.transport_enabled,
          transport_price: dto.transport_enabled ? dto.transport_price : null,
          deposit_amount: dto.deposit_amount,
          deposit_type: dto.deposit_type,
          final_payment_date: dto.final_payment_date
            ? new Date(dto.final_payment_date)
            : null,
        },
      });

      await tx.eventrooms.createMany({
        data: dto.rooms.map((room) => buildEventroomRow(event.event_id, room)),
      });

      if (dto.installments.length > 0) {
        await tx.event_payment_schedules.createMany({
          data: dto.installments.map((inst, index) => ({
            event_id: event.event_id,
            installment_number: index + 1,
            amount_type: inst.amount_type,
            amount: inst.amount,
            due_date: new Date(inst.due_date),
          })),
        });
      }

      return event.event_id;
    });

    return this.findOne(createdEventId);
  }

  async update(id: number, dto: UpdateEventDto) {
    const current = await this.findOne(id);
    this.validateEventRules({
      check_in: dto.check_in ?? current.check_in,
      check_out: dto.check_out ?? current.check_out,
      deposit_type: dto.deposit_type ?? current.deposit_type,
      deposit_amount: dto.deposit_amount ?? Number(current.deposit_amount),
      installments: dto.installments,
    });

    await this.prisma.$transaction(async (tx) => {
      const { rooms, installments, ...eventFields } = dto;

      await tx.events.update({
        where: { event_id: id },
        data: {
          ...eventFields,
          transport_price:
            eventFields.transport_enabled === false
              ? null
              : eventFields.transport_price,
          final_payment_date: eventFields.final_payment_date
            ? new Date(eventFields.final_payment_date)
            : undefined,
        },
      });

      if (rooms) {
        await tx.eventrooms.deleteMany({ where: { event_id: String(id) } });
        await tx.eventrooms.createMany({
          data: rooms.map((room) => buildEventroomRow(id, room)),
        });
      }

      if (installments) {
        await tx.event_payment_schedules.deleteMany({
          where: { event_id: id },
        });
        await tx.event_payment_schedules.createMany({
          data: installments.map((inst, index) => ({
            event_id: id,
            installment_number: index + 1,
            amount_type: inst.amount_type,
            amount: inst.amount,
            due_date: new Date(inst.due_date),
          })),
        });
      }
    });

    return this.findOne(id);
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.$transaction([
      this.prisma.eventrooms.deleteMany({ where: { event_id: String(id) } }),
      this.prisma.event_payment_schedules.deleteMany({ where: { event_id: id } }),
      this.prisma.events.delete({ where: { event_id: id } }),
    ]);
    return { deleted: true };
  }
}
