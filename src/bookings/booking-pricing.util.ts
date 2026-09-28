import { BadRequestException } from '@nestjs/common';
import { BookingRoomLineDto } from './dto/create-booking.dto.js';

export interface ResolvedRoomLine extends BookingRoomLineDto {
  base_rate: number;
  nights: number;
  eligible_for_room: number;
  room_total: number;
}

// One `eventrooms` row holds one `room_name` with its capacity options
// flattened into parallel comma-joined lists (capacity_name / room_cap /
// room_price) — this is the same legacy convention the old EventController
// writes (and the new EventsService.buildEventroomRow still writes it that
// way, since both apps read the same MySQL tables).
export function resolveRoomRate(
  eventroom: { room_cap: string | null; room_price: string | null } | undefined,
  roomCap: string,
): number {
  if (!eventroom?.room_cap || !eventroom.room_price) {
    throw new BadRequestException(`Room type not available for this event.`);
  }
  const caps = eventroom.room_cap.split(',');
  const prices = eventroom.room_price.split(',');
  const index = caps.indexOf(roomCap);
  if (index === -1) {
    throw new BadRequestException(`Selected room capacity is not available.`);
  }
  return parseFloat(prices[index]);
}

function countEligibleChildren(childAge?: string): number {
  if (!childAge) return 0;
  return childAge
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .filter((a) => parseInt(a, 10) >= 3).length;
}

function diffInDays(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Children under 3 stay free (room capacity only) — ages 3+ count as an
// extra person for the room rate. Every child, regardless of age, still
// counts toward transport (see totalPeopleForTransport below).
export function resolveRoomLine(
  line: BookingRoomLineDto,
  baseRate: number,
): ResolvedRoomLine {
  const nights = Math.max(1, diffInDays(line.checkin, line.checkout));
  const eligibleForRoom = Math.max(
    1,
    line.adults + countEligibleChildren(line.child_age),
  );
  const roomTotal = Math.round(baseRate * eligibleForRoom * nights * line.quantity * 100) / 100;

  return { ...line, base_rate: baseRate, nights, eligible_for_room: eligibleForRoom, room_total: roomTotal };
}

export function totalPeopleForTransport(rooms: BookingRoomLineDto[]): number {
  return rooms.reduce(
    (sum, r) => sum + r.quantity * (r.adults + (r.children ?? 0)),
    0,
  );
}

export function calculateDeposit(
  grandTotal: number,
  depositAmount: number,
  depositType: string,
): number {
  const raw =
    depositType === 'percent' ? grandTotal * (depositAmount / 100) : depositAmount;
  return Math.round(Math.min(raw, grandTotal) * 100) / 100;
}
