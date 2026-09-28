import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
})
export class UploadsModule {}
