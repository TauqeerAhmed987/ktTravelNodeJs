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
  @IsString()
  preferred_name?: string;

  @IsOptional()
  @IsString()
  member_designation?: string;

  @IsOptional()
  @IsString()
  industry_type?: string;

  @IsOptional()
  @IsString()
  mailing_address?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: string;
}

// Admin "Add Member" form: no password field — the server generates one and
// emails it, like the old system did.
export class CreateMemberDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  client_phone?: string;

  @IsOptional()
  @IsString()
  client_adsress?: string;

  @IsOptional()
  @IsString()
  mailing_address?: string;

  @IsOptional()
  @IsString()
  industry_type?: string;

  @IsOptional()
  @IsString()
  preferred_name?: string;

  @IsOptional()
  @IsString()
  member_designation?: string;
}
