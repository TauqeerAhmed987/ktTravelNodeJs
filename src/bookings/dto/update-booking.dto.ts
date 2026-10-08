import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateBookingScheduleItemDto {
  @IsNumber()
  amount: number;

  @IsDateString()
  due_date: string;
}

export class UpdateBookingDto {
  // New stay dates (must stay within the event's dates). Omitted = keep the saved dates.
  @IsOptional()
  @IsDateString()
  checkin?: string;

  @IsOptional()
  @IsDateString()
  checkout?: string;

  @IsInt()
  @Min(0)
  adults: number;

  @IsInt()
  @Min(0)
  children: number;

  @IsOptional()
  @IsString()
  child_age?: string;

  @IsString()
  room_id: string;

  @IsInt()
  @Min(1)
  room_count: number;

  // Per-person nightly rate typed in the admin form. When omitted the server uses the rate of
  // the room's capacity option that matches the adults/children (or the rate already saved).
  @IsOptional()
  @IsNumber()
  @Min(0)
  rate_per_person?: number;

  @IsBoolean()
  transport_enabled: boolean;

  @IsOptional()
  @IsNumber()
  transport_per_person?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateBookingScheduleItemDto)
  schedules?: UpdateBookingScheduleItemDto[];
}
