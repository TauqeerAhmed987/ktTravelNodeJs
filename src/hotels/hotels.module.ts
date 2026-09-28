import { Module } from '@nestjs/common';
import { HotelsService } from './hotels.service.js';
import { HotelsController } from './hotels.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [HotelsService],
})
export class HotelsModule {}
