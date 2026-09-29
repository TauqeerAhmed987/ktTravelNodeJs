import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomBytes } from 'crypto';
import { MailService } from '../mail/mail.service.js';
import { CreateMemberDto, CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

function sanitize(user: any) {
  const { password, google2fa_secret, ...safe } = user;
  return { ...safe, id: Number(user.id) };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async findAll(role?: number) {
    const users = await this.prisma.users.findMany({
      where: role ? { role } : undefined,
      orderBy: { id: 'desc' },
    });
    return users.map(sanitize);
  }

  // Admin's own team members (role 4) — mirrors the old MembersController@members
  async listMembers(adminId: number) {
    const users = await this.prisma.users.findMany({
      where: { role: 4, user_created_by: String(adminId) },
      orderBy: { id: 'desc' },
    });
    return users.map(sanitize);
  }

  async createMember(dto: CreateMemberDto, adminId: number) {
    const existing = await this.prisma.users.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('The email has already been taken.');

    const plainPassword = randomBytes(8).toString('hex');
    const user = await this.prisma.users.create({
      data: {
        role: 4,
        user_created_by: String(adminId),
        name: dto.name,
        email: dto.email,
        password: await bcrypt.hash(plainPassword, 10),
        client_phone: dto.client_phone,
        client_adsress: dto.client_adsress,
        mailing_address: dto.mailing_address,
        industry_type: dto.industry_type,
        preferred_name: dto.preferred_name,
        member_designation: dto.member_designation,
        status: 'active',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    await this.mail.sendMemberCredentials({ name: dto.name, email: dto.email, password: plainPassword });
    return sanitize(user);
  }

  async findOne(id: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: BigInt(id) },
    });
    if (!user) throw new NotFoundException('User not found.');
    return sanitize(user);
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('The email has already been taken.');
    }

    const user = await this.prisma.users.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: await bcrypt.hash(dto.password, 10),
        role: dto.role,
        client_phone: dto.client_phone,
        client_adsress: dto.client_adsress,
        client_profile: dto.client_profile,
        status: 'active',
        // users.created_at has no DB/Prisma default; the dashboard's monthly charts group by it
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    return sanitize(user);
  }

  async update(id: number, dto: UpdateUserDto) {
    await this.findOne(id);
    if (dto.email) {
      const existing = await this.prisma.users.findUnique({
        where: { email: dto.email },
      });
      if (existing && Number(existing.id) !== id) {
        throw new ConflictException('The email has already been taken.');
      }
    }
    const user = await this.prisma.users.update({
      where: { id: BigInt(id) },
      data: { ...dto, updated_at: new Date() },
    });
    return sanitize(user);
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.users.delete({ where: { id: BigInt(id) } });
    return { deleted: true };
  }

  // Mirrors the old MainController@clients query exactly: a LEFT JOIN of
  // role-3 users against bookings by user_id — a client with N bookings
  // produces N rows (one per booking), not one deduplicated row. Confirmed
  // against the real running old system (e.g. a repeat client showed up
  // four times in its client list, once per booking).
  async getClientsOverview() {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        users.id, users.name, users.email, users.client_phone, users.client_profile, users.status,
        bookings.booking_id, bookings.total_card_amount, bookings.balance,
        bookings.total_amount_after_percent, bookings.nextpayment, bookings.nextmonthdate,
        bookings.created_at AS booking_created_at
      FROM users
      LEFT JOIN bookings ON users.id = bookings.user_id
      WHERE users.role = 3
      ORDER BY bookings.booking_id DESC
    `;
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  // Mirrors ClientController@view_client's join chain exactly, including
  // the hotels/rooms joins keyed by id (events.hotel_name holds a hotel id,
  // bookingrooms.room_id holds a rooms_id — see EventsService for the same
  // legacy-naming discovery).
  async getClientProfile(id: number) {
    const user = await this.findOne(id);
    const bookings = await this.prisma.$queryRaw<any[]>`
      SELECT
        bookings.booking_id, bookings.access_code, bookings.total_card_amount,
        bookings.total_amount_after_percent, bookings.balance, bookings.payment_paused,
        bookings.created_at, bookingrooms.checkin, bookingrooms.checkout, bookingrooms.event_id,
        events.event_name, hotels.hotel_name, rooms.room_name
      FROM bookings
      LEFT JOIN bookingrooms ON bookings.booking_id = bookingrooms.booking_id
      LEFT JOIN events ON bookingrooms.event_id = events.event_id
      LEFT JOIN hotels ON events.hotel_name = hotels.hotel_id
      LEFT JOIN rooms ON bookingrooms.room_id = rooms.rooms_id
      WHERE bookings.user_id = ${String(id)}
      GROUP BY
        bookings.booking_id, bookings.access_code, bookings.total_card_amount,
        bookings.total_amount_after_percent, bookings.balance, bookings.payment_paused,
        bookings.created_at, bookingrooms.checkin, bookingrooms.checkout,
        bookingrooms.event_id, events.event_name, hotels.hotel_name, rooms.room_name
      ORDER BY bookings.created_at DESC
    `;
    return { user, bookings };
  }
}
