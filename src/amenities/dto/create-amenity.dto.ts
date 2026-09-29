import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAmenityDto {
  @IsString()
  @IsNotEmpty()
  amenities_name: string;

  @IsOptional()
  @IsString()
  amenities_image?: string;
}
