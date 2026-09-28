import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CapacitiesService } from './capacities.service.js';
import { CreateCapacityDto } from './dto/create-capacity.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../auth/roles.enum.js';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF, Role.MEMBER)
@Controller('capacities')
export class CapacitiesController {
  constructor(private readonly capacitiesService: CapacitiesService) {}

  @Get()
  findAll() {
    return this.capacitiesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateCapacityDto) {
    return this.capacitiesService.create(dto.adult_child, dto.user_id);
  }
}
