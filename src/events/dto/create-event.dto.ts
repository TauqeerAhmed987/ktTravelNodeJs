import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';

export class RoomCapacityDto {
  @IsString()
  capacity_name: string; // e.g. "2 Adults"

  @IsString()
  room_cap: string; // e.g. "2_Adults" (slug form, matches legacy convention)

  @IsNumber()
  @Min(0)
  room_price: number;
}

export class EventRoomDto {
  // The real `rooms.rooms_id` this line refers to. Persisted into the
  // `eventrooms.room_name` column, matching the legacy system's own
  // (confusingly named) convention — verified against real data: an old
  // event's `eventrooms.room_name` holds a numeric room id, not room text,
  // and the old view page resolves it via `rooms->firstWhere('rooms_id', ...)`.
  @IsString()
  room_id: string;

  @IsString()
  room_name: string; // display label only, not persisted as-is

  @IsNumber()
  @Min(1)
  no_of_rooms: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoomCapacityDto)
  capacities: RoomCapacityDto[];
}

export class InstallmentDto {
  @IsIn(['fixed', 'percent'])
  amount_type: 'fixed' | 'percent';

  @IsNumber()
  @Min(0)
  amount: number;

  @IsDateString()
  due_date: string;
}

export class CreateEventDto {
  @IsString()
  client_created_by: string;

  @IsString()
  client_name: string;

  @IsOptional()
  @IsString()
  client_email?: string;

  @IsOptional()
  @IsString()
  client_phone?: string;

  @IsString()
  event_name: string;

  @IsString()
  event_color_code: string;

  @IsDateString()
  check_in: string;

  @IsDateString()
  check_out: string;

  // The real `hotels.hotel_id`, persisted as-is into the `hotel_name` column
  // — same legacy convention as room_id above (verified: an old event's
  // `hotel_name` holds a numeric hotel id, e.g. "13", not hotel text).
  @IsString()
  hotel_name: string;

  @IsString()
  event_description: string;

  @IsString()
  event_terms: string;

  @IsOptional()
  @IsString()
  event_profile?: string;

  @IsOptional()
  @IsString()
  event_cover?: string;

  @IsBoolean()
  transport_enabled: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  transport_price?: number;

  @IsNumber()
  @Min(1)
  @Max(100)
  deposit_amount: number;

  @IsIn(['fixed', 'percent'])
  deposit_type: 'fixed' | 'percent';

  @IsOptional()
  @IsDateString()
  final_payment_date?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventRoomDto)
  rooms: EventRoomDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments: InstallmentDto[];
}
