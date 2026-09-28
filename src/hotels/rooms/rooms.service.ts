import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { UpdateRoomDto } from './dto/update-room.dto.js';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(hotelId?: string) {
    return this.prisma.rooms.findMany({
      where: hotelId ? { hotel_id: hotelId } : undefined,
      orderBy: { rooms_id: 'desc' },
    });
  }

  async findOne(id: number) {
    const room = await this.prisma.rooms.findUnique({ where: { rooms_id: id } });
    if (!room) throw new NotFoundException('Room not found.');
    return room;
  }

  create(dto: CreateRoomDto) {
    return this.prisma.rooms.create({ data: dto });
  }

  async update(id: number, dto: UpdateRoomDto) {
    await this.findOne(id);
    return this.prisma.rooms.update({ where: { rooms_id: id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.rooms.delete({ where: { rooms_id: id } });
    return { deleted: true };
  }
}
