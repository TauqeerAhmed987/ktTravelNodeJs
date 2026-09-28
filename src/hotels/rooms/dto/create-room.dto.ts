import { IsOptional, IsString } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  hotel_id: string;

  @IsString()
  room_name: string;

  @IsOptional()
  @IsString()
  room_type?: string;

  @IsOptional()
  @IsString()
  no_of_rooms?: string;

  @IsOptional()
  @IsString()
  room_amenities?: string;

  @IsOptional()
  @IsString()
  room_capacity?: string;

  @IsOptional()
  @IsString()
  room_description?: string;

  @IsOptional()
  @IsString()
  room_image?: string;
}
