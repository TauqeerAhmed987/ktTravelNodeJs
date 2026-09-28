import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn([1, 2, 3, 4, 5])
  role: number;

  @IsOptional()
  @IsString()
  client_phone?: string;

  @IsOptional()
  @IsString()
  client_adsress?: string;

  @IsOptional()
  @IsString()
  client_profile?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;
}
