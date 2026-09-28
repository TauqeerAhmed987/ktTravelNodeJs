import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BookingsService } from './bookings.service.js';
import { PausePaymentsDto } from './dto/pause-payments.dto.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { PayInstallmentDto } from './dto/pay-installment.dto.js';
import { UpdateBookingDto } from './dto/update-booking.dto.js';
import { RequestChangeDto } from './dto/request-change.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../auth/roles.enum.js';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // Public — the guest self-booking flow (event lookup -> pricing -> Stripe
  // deposit charge -> booking record), from the guest web portal.
  @Post()
  create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.createGuestBooking(dto);
  }

  // Public — the guest's "My Booking" page, looked up by their access code.
  @Get('by-access-code/:code')
  findByAccessCode(@Param('code') code: string) {
    return this.bookingsService.findByAccessCode(code);
  }

  // Public — guest pays one upcoming installment, scoped by their own
  // booking access_code (checked inside the service).
  @Post('pay-installment')
  payInstallment(@Body() dto: PayInstallmentDto) {
    return this.bookingsService.payInstallment(dto);
  }

  // Public — guest's own invoice PDF, scoped by their access code (no JWT).
  @Get('by-access-code/:code/invoice')
  async getInvoiceByAccessCode(@Param('code') code: string, @Res() res: Response) {
    const { pdf, filename } = await this.bookingsService.getInvoicePdfByAccessCode(code);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }

  // Public — guest's free-text "Request a Change" form on My Booking.
  @Post('request-change')
  requestChange(@Body() dto: RequestChangeDto) {
    return this.bookingsService.requestChange(dto.access_code, dto.message);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF, Role.MEMBER)
  @Get('by-event/:eventId')
  findByEvent(@Param('eventId', ParseIntPipe) eventId: number) {
    return this.bookingsService.findByEvent(eventId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF, Role.MEMBER)
  @Get(':id/detail')
  getReservationDetail(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.getReservationDetail(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF, Role.MEMBER)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @Patch(':id/pause')
  pause(@Param('id', ParseIntPipe) id: number, @Body() dto: PausePaymentsDto) {
    return this.bookingsService.pausePayments(id, dto.reason);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @Patch(':id/resume')
  resume(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.resumePayments(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @Patch(':id/update')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookingDto) {
    return this.bookingsService.updateBooking(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF)
  @Post(':id/send-update-email')
  sendUpdateEmail(@Param('id', ParseIntPipe) id: number) {
    return this.bookingsService.sendBookingUpdateEmail(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.STAFF, Role.MEMBER)
  @Get(':id/invoice')
  async getInvoice(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { pdf, filename } = await this.bookingsService.getInvoicePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  }
}
