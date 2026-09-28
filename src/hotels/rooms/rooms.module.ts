import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service.js';
import { RoomsController } from './rooms.controller.js';
import { AuthModule } from '../../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
