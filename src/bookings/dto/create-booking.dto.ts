import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BookingRoomLineDto {
  @IsString()
  room_name: string;

  @IsString()
  room_cap: string; // must match one of the event's eventroom capacity slugs

  @IsInt()
  @Min(1)
  quantity: number;

  @IsDateString()
  checkin: string;

  @IsDateString()
  checkout: string;

  @IsInt()
  @Min(1)
  adults: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @IsOptional()
  @IsString()
  child_age?: string; // comma-separated ages, e.g. "4,7"
}

export class BookingBillingDto {
  @IsString()
  first_name: string;

  @IsString()
  last_name: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  street_1: string;

  @IsOptional()
  @IsString()
  street_2?: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  postcode: string;

  @IsString()
  country: string;
}

export class CreateBookingDto {
  @IsString()
  event_code: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingRoomLineDto)
  rooms: BookingRoomLineDto[];

  @IsBoolean()
  transport_opt_in: boolean;

  @ValidateNested()
  @Type(() => BookingBillingDto)
  billing: BookingBillingDto;

  @IsBoolean()
  terms_accepted: boolean;

  // Free-text note the guest typed in the checkout "Comments" box
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;

  @IsString()
  stripe_token: string;
}
