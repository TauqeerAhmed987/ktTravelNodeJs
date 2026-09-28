import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Verify2faDto } from './dto/verify-2fa.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { userId: number; role: number }) {
    return user;
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('2fa/setup/generate')
  generate2faSetup(@Body('tempToken') tempToken: string) {
    return this.authService.generate2faSetup(tempToken);
  }

  @Post('2fa/setup/verify')
  confirm2faSetup(@Body() dto: Verify2faDto) {
    return this.authService.confirm2faSetup(dto);
  }

  @Post('2fa/verify')
  verify2fa(@Body() dto: Verify2faDto) {
    return this.authService.verify2fa(dto);
  }
}
