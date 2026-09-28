import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AmenitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.amenities.findMany({ orderBy: { amenities_id: 'asc' } });
  }
}
