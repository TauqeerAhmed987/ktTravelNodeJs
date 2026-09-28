import { Module } from '@nestjs/common';
import { CapacitiesService } from './capacities.service.js';
import { CapacitiesController } from './capacities.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [CapacitiesController],
  providers: [CapacitiesService],
  exports: [CapacitiesService],
})
export class CapacitiesModule {}
