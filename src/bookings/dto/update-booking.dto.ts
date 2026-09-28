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
  @IsDateString()
  checkin: string;

  @IsDateString()
  checkout: string;

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
