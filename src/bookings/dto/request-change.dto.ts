import { IsString, MinLength } from 'class-validator';

export class RequestChangeDto {
  @IsString()
  access_code: string;

  @IsString()
  @MinLength(10)
  message: string;
}
