import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAmenityDto } from './dto/create-amenity.dto.js';
import { UpdateAmenityDto } from './dto/update-amenity.dto.js';

@Injectable()
export class AmenitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.amenities.findMany({ orderBy: { amenities_id: 'asc' } });
  }

  async findOne(id: number) {
    const amenity = await this.prisma.amenities.findUnique({ where: { amenities_id: id } });
    if (!amenity) throw new NotFoundException('Amenity not found.');
    return amenity;
  }

  create(dto: CreateAmenityDto, createdBy: number) {
    return this.prisma.amenities.create({
      data: {
        amenities_name: dto.amenities_name,
        amenities_image: dto.amenities_image,
        amenities_created_by: String(createdBy),
      },
    });
  }

  async update(id: number, dto: UpdateAmenityDto) {
    await this.findOne(id);
    return this.prisma.amenities.update({
      where: { amenities_id: id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.amenities.delete({ where: { amenities_id: id } });
    return { deleted: true };
  }
}
