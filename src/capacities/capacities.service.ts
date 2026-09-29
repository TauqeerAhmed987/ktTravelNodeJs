import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CapacitiesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.capacities.findMany({ orderBy: { capacity_id: 'asc' } });
  }

  async findOne(id: number) {
    const capacity = await this.prisma.capacities.findUnique({ where: { capacity_id: id } });
    if (!capacity) throw new NotFoundException('Capacity not found.');
    return capacity;
  }

  create(adult_child: string, user_id?: string) {
    return this.prisma.capacities.create({ data: { adult_child, user_id } });
  }

  async update(id: number, adult_child: string) {
    await this.findOne(id);
    return this.prisma.capacities.update({
      where: { capacity_id: id },
      data: { adult_child, updated_at: new Date() },
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.capacities.delete({ where: { capacity_id: id } });
    return { deleted: true };
  }
}
