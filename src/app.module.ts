import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { HotelsModule } from './hotels/hotels.module.js';
import { RoomsModule } from './hotels/rooms/rooms.module.js';
import { EventsModule } from './events/events.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { MailModule } from './mail/mail.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { AmenitiesModule } from './amenities/amenities.module.js';
import { CapacitiesModule } from './capacities/capacities.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    MailModule,
    AuthModule,
    UsersModule,
    HotelsModule,
    RoomsModule,
    EventsModule,
    BookingsModule,
    DashboardModule,
    UploadsModule,
    AmenitiesModule,
    CapacitiesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
