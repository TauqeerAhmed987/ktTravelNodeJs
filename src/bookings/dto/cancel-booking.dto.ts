import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelBookingDto {
  // true: refund what the guest paid (Stripe refunds where a charge id is on record,
  // a "refund due" entry otherwise). false/omitted: cancel only, no money moves.
  @IsOptional()
  @IsBoolean()
  refund?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
