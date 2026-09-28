import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateHotelDto {
  @IsString()
  hotel_name: string;

  @IsOptional()
  @IsString()
  hotel_location?: string;

  @IsOptional()
  @IsString()
  hotel_rating?: string;

  @IsOptional()
  @IsString()
  hotel_amenities?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  hotelimages?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  hotel_status?: string;
}
