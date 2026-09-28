import { Module } from '@nestjs/common';
import { AmenitiesService } from './amenities.service.js';
import { AmenitiesController } from './amenities.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [AmenitiesController],
  providers: [AmenitiesService],
  exports: [AmenitiesService],
})
export class AmenitiesModule {}
