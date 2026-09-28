import { IsOptional, IsString } from 'class-validator';

export class CreateCapacityDto {
  @IsString()
  adult_child: string;

  @IsOptional()
  @IsString()
  user_id?: string;
}
