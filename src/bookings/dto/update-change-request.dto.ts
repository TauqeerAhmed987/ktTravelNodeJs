import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateChangeRequestDto {
  @IsIn(['open', 'resolved'])
  status: 'open' | 'resolved';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  admin_note?: string;
}
