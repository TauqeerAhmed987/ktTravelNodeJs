import { IsInt, IsString } from 'class-validator';

export class PayInstallmentDto {
  @IsString()
  access_code: string;

  @IsInt()
  schedule_id: number;

  @IsString()
  stripe_token: string;
}
