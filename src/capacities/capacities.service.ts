import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CapacitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.capacities.findMany({ orderBy: { capacity_id: 'asc' } });
  }

  create(adult_child: string, user_id?: string) {
    return this.prisma.capacities.create({ data: { adult_child, user_id } });
  }
}
