import { IsOptional, IsString } from 'class-validator';

export class PausePaymentsDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
