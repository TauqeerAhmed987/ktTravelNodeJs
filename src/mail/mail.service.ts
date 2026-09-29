import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { generateInvoicePdf, InvoiceData } from './invoice-pdf.util.js';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;
  private readonly webAppUrl: string;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST'),
      port: Number(this.config.get<string>('MAIL_PORT')),
      secure: false,
      auth: {
        user: this.config.get<string>('MAIL_USERNAME'),
        pass: this.config.get<string>('MAIL_PASSWORD'),
      },
    });
    this.fromAddress = `${this.config.get<string>('MAIL_FROM_NAME')} <${this.config.get<string>('MAIL_FROM_ADDRESS')}>`;
    this.webAppUrl = this.config.get<string>('WEB_APP_URL') ?? 'http://localhost:3001';
  }

  // Failures here must never block a booking/payment that already
  // succeeded — email is a notification, not a transaction participant.
  private async safeSend(options: { to: string; subject: string; html: string; attachments?: any[] }) {
    try {
      await this.transporter.sendMail({ from: this.fromAddress, ...options });
    } catch (err) {
      this.logger.error(`Failed to send email to ${options.to}: ${(err as Error).message}`);
    }
  }

  async sendBookingConfirmation(params: {
    guestEmail: string;
    guestName: string;
    guestPhone: string;
    accessCode: string;
    invoiceData: InvoiceData;
  }) {
    const pdf = await generateInvoicePdf(params.invoiceData);
    const myBookingUrl = `${this.webAppUrl}/my-booking?code=${params.accessCode}`;

    await this.safeSend({
      to: params.guestEmail,
      subject: `Booking Confirmed — ${params.invoiceData.eventName}`,
      html: `
        <p>Hi ${params.guestName},</p>
        <p>Your reservation for <strong>${params.invoiceData.eventName}</strong> at ${params.invoiceData.hotelName} is confirmed.</p>
        <p><strong>Deposit paid:</strong> $${params.invoiceData.depositPaid.toFixed(2)}<br/>
           <strong>Remaining balance:</strong> $${params.invoiceData.balance.toFixed(2)}</p>
        <p>Your Booking Access Code: <strong>${params.accessCode}</strong></p>
        <p><a href="${myBookingUrl}">View &amp; manage your booking</a></p>
        <p>Your invoice is attached.</p>
      `,
      attachments: [
        { filename: `invoice-${params.invoiceData.invoiceNumber}.pdf`, content: pdf },
      ],
    });
  }

  async sendMemberCredentials(params: { name: string; email: string; password: string }) {
    await this.safeSend({
      to: params.email,
      subject: 'Your KT Travel dashboard login',
      html: `
        <p>Dear ${params.name},</p>
        <p>Your KT Travel login access has been created by the admin.</p>
        <p><strong>Email:</strong> ${params.email}<br/>
           <strong>Password:</strong> ${params.password}</p>
        <p><a href="${this.webAppUrl}/login">Log in to the dashboard</a></p>
      `,
    });
  }

  async sendInstallmentReminder(params: {
    guestEmail: string;
    guestName: string;
    accessCode: string;
    installmentNumber: number;
    amount: number;
    dueDate: string;
    balance: number;
  }) {
    const myBookingUrl = `${this.webAppUrl}/my-booking?code=${params.accessCode}`;
    await this.safeSend({
      to: params.guestEmail,
      subject: `Payment Reminder — Installment Due Tomorrow`,
      html: `
        <p>Hi ${params.guestName},</p>
        <p>This is a reminder that installment #${params.installmentNumber} of
           <strong>$${params.amount.toFixed(2)}</strong> is due on ${params.dueDate}.</p>
        <p>Remaining balance: $${params.balance.toFixed(2)}</p>
        <p>Booking Access Code: <strong>${params.accessCode}</strong></p>
        <p><a href="${myBookingUrl}">Pay now from your My Booking page</a></p>
      `,
    });
  }

  // Sent when an admin edits a booking from the Reservation Detail page —
  // mirrors the old system's email.booking_update Blade template (same
  // header/summary-table/PDF-note structure) with a freshly regenerated
  // invoice PDF attached.
  async sendBookingUpdate(params: {
    guestEmail: string;
    guestName: string;
    accessCode: string;
    eventName?: string;
    checkin?: string;
    checkout?: string;
    invoiceData: InvoiceData;
  }) {
    const pdf = await generateInvoicePdf(params.invoiceData);
    const { grandTotal, depositPaid, balance } = params.invoiceData;
    const balanceColor = balance > 0 ? '#c0392b' : '#27ae60';

    await this.safeSend({
      to: params.guestEmail,
      subject: 'Your Booking Has Been Updated – KT Travel & More',
      html: `
        <div style="margin:0; padding:0; background:#f4f4f4; font-family:Arial, sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4; padding:30px 0;">
            <tr><td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:8px; overflow:hidden;">
                <tr>
                  <td style="background:#325440; padding:30px; text-align:center;">
                    <div style="font-size:22px; font-weight:700; color:#ffffff; margin-bottom:4px;">KT Travel &amp; More</div>
                    <div style="font-size:13px; color:#b8d8c4;">Your Booking Has Been Updated</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <p style="font-size:15px; color:#333; margin:0 0 10px;">Dear <strong>${params.guestName}</strong>,</p>
                    <p style="font-size:14px; color:#555; line-height:1.7; margin:0 0 24px;">
                      Your reservation with <strong>KT Travel &amp; More</strong> has been updated by our team.
                      Please find your <strong>updated invoice attached</strong> to this email for your records.
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5faf7; border:1px solid #d0e8db; border-radius:8px; margin-bottom:24px;">
                      <tr>
                        <td style="padding:14px 18px; border-bottom:1px solid #e0ede6;">
                          <span style="font-size:12px; font-weight:700; color:#325440; text-transform:uppercase; letter-spacing:0.5px;">Booking Summary</span>
                        </td>
                      </tr>
                      <tr><td style="padding:0 18px;">
                        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
                          <tr>
                            <td style="padding:10px 0; color:#777; border-bottom:1px solid #f0f0f0; width:45%;">Booking Code</td>
                            <td style="padding:10px 0; color:#333; font-weight:700; border-bottom:1px solid #f0f0f0;">${params.accessCode.toUpperCase()}</td>
                          </tr>
                          ${params.eventName ? `<tr><td style="padding:10px 0; color:#777; border-bottom:1px solid #f0f0f0;">Event</td><td style="padding:10px 0; color:#333; border-bottom:1px solid #f0f0f0;">${params.eventName}</td></tr>` : ''}
                          ${params.checkin ? `<tr><td style="padding:10px 0; color:#777; border-bottom:1px solid #f0f0f0;">Check-in</td><td style="padding:10px 0; color:#333; border-bottom:1px solid #f0f0f0;">${params.checkin}</td></tr>` : ''}
                          ${params.checkout ? `<tr><td style="padding:10px 0; color:#777; border-bottom:1px solid #f0f0f0;">Check-out</td><td style="padding:10px 0; color:#333; border-bottom:1px solid #f0f0f0;">${params.checkout}</td></tr>` : ''}
                          <tr>
                            <td style="padding:10px 0; color:#777; border-bottom:1px solid #f0f0f0;">Total Amount</td>
                            <td style="padding:10px 0; color:#333; font-weight:600; border-bottom:1px solid #f0f0f0;">$${grandTotal.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td style="padding:10px 0; color:#777; border-bottom:1px solid #f0f0f0;">Amount Paid</td>
                            <td style="padding:10px 0; color:#27ae60; font-weight:600; border-bottom:1px solid #f0f0f0;">$${depositPaid.toFixed(2)}</td>
                          </tr>
                          <tr>
                            <td style="padding:10px 0; color:#777;">Remaining Balance</td>
                            <td style="padding:10px 0; color:${balanceColor}; font-weight:700;">$${balance.toFixed(2)}</td>
                          </tr>
                        </table>
                      </td></tr>
                    </table>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#e8f4fd; border:1px solid #b3d7f0; border-left:4px solid #2980b9; border-radius:6px; margin-bottom:24px;">
                      <tr><td style="padding:14px 18px; font-size:13px; color:#444; line-height:1.6;">
                        Your <strong>updated invoice is attached</strong> to this email as a PDF.<br/>
                        It includes your full booking details, payment schedule, and all updated information.
                      </td></tr>
                    </table>
                    <p style="font-size:14px; color:#555; line-height:1.7; margin:0 0 6px;">
                      If you have any questions or need further assistance, please don't hesitate to contact us.
                    </p>
                    <p style="font-size:14px; color:#555; margin:0;">
                      Thank you,<br/>
                      <strong style="color:#325440;">KT Travel &amp; More Team</strong>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f4f4f4; padding:16px; text-align:center; font-size:12px; color:#999;">
                    &copy; ${new Date().getFullYear()} KT Travel &amp; More. All rights reserved.
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </div>
      `,
      attachments: [
        { filename: `invoice-${params.invoiceData.invoiceNumber}.pdf`, content: pdf },
      ],
    });
  }

  // Mirrors ClientController::requestChange() — notifies the business inbox
  // (MAIL_FROM_ADDRESS) of a guest's free-text change request from their
  // My Booking page. Sent to the admin, not the guest.
  async sendChangeRequest(params: {
    guestName: string;
    guestEmail: string;
    accessCode: string;
    message: string;
  }) {
    const adminAddress = this.config.get<string>('MAIL_FROM_ADDRESS') as string;
    await this.safeSend({
      to: adminAddress,
      subject: 'Booking Change Request – KT Travel',
      html: `
        <p><strong>Guest:</strong> ${params.guestName} (${params.guestEmail})</p>
        <p><strong>Booking Code:</strong> ${params.accessCode.toUpperCase()}</p>
        <p><strong>Requested change:</strong></p>
        <p>${params.message.replace(/\n/g, '<br/>')}</p>
      `,
    });
  }

  async sendPaymentReceipt(params: {
    guestEmail: string;
    guestName: string;
    accessCode: string;
    amount: number;
    newBalance: number;
  }) {
    await this.safeSend({
      to: params.guestEmail,
      subject: 'Payment Received',
      html: `
        <p>Hi ${params.guestName},</p>
        <p>We've received your payment of <strong>$${params.amount.toFixed(2)}</strong>. Thank you!</p>
        <p>Remaining balance: $${params.newBalance.toFixed(2)}</p>
        <p>Booking Access Code: <strong>${params.accessCode}</strong></p>
      `,
    });
  }
}
