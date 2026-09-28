import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateHotelDto } from './dto/create-hotel.dto.js';
import { UpdateHotelDto } from './dto/update-hotel.dto.js';

@Injectable()
export class HotelsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.hotels.findMany({ orderBy: { hotel_id: 'desc' } });
  }

  async findOne(id: number) {
    const hotel = await this.prisma.hotels.findUnique({
      where: { hotel_id: id },
    });
    if (!hotel) throw new NotFoundException('Hotel not found.');
    return hotel;
  }

  create(dto: CreateHotelDto) {
    return this.prisma.hotels.create({ data: { ...dto, hotel_status: 'active' } });
  }

  async update(id: number, dto: UpdateHotelDto) {
    await this.findOne(id);
    return this.prisma.hotels.update({ where: { hotel_id: id }, data: dto });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.hotels.delete({ where: { hotel_id: id } });
    return { deleted: true };
  }
}
