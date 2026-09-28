import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Verify2faDto } from './dto/verify-2fa.dto.js';
import { DASHBOARD_BLOCKED_ROLES } from './roles.enum.js';

const TEMP_TOKEN_TTL = '10m';
const ACCESS_TOKEN_TTL = '12h';

interface TempTokenPayload {
  sub: number;
  stage: '2fa_setup' | '2fa_verify' | '2fa_setup_confirm';
  secret?: string; // only present for 2fa_setup_confirm — the not-yet-saved pending secret
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private sanitizeUser(user: any) {
    const { password, google2fa_secret, ...safe } = user;
    return { ...safe, id: Number(user.id) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Credentials are invalid!');
    }

    if (DASHBOARD_BLOCKED_ROLES.includes(user.role as number)) {
      throw new UnauthorizedException(
        'Access denied. Please contact the admin team.',
      );
    }

    // Temporary local-testing convenience — see DISABLE_2FA in .env.
    // Remove this before going live.
    if (this.config.get<string>('DISABLE_2FA') === 'true') {
      return this.issueAccessToken(user);
    }

    if (!user.google2fa_secret) {
      const tempToken = this.jwt.sign(
        { sub: Number(user.id), stage: '2fa_setup' } as TempTokenPayload,
        { expiresIn: TEMP_TOKEN_TTL },
      );
      return { requires2faSetup: true, tempToken };
    }

    const tempToken = this.jwt.sign(
      { sub: Number(user.id), stage: '2fa_verify' } as TempTokenPayload,
      { expiresIn: TEMP_TOKEN_TTL },
    );
    return { requires2faVerify: true, tempToken };
  }

  async generate2faSetup(tempToken: string) {
    const payload = this.decodeTempToken(tempToken, '2fa_setup');
    const user = await this.findUserOrThrow(payload.sub);

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'KT Travel', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    const setupToken = this.jwt.sign(
      {
        sub: payload.sub,
        stage: '2fa_setup_confirm',
        secret,
      } as TempTokenPayload,
      { expiresIn: TEMP_TOKEN_TTL },
    );

    return { qrCodeDataUrl, secret, tempToken: setupToken };
  }

  async confirm2faSetup(dto: Verify2faDto) {
    const payload = this.decodeTempToken(dto.tempToken, '2fa_setup_confirm');
    if (!payload.secret) {
      throw new BadRequestException('Setup session expired, please restart.');
    }

    const isValid = authenticator.check(dto.code, payload.secret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code.');
    }

    const user = await this.prisma.users.update({
      where: { id: payload.sub },
      data: { google2fa_secret: payload.secret },
    });

    return this.issueAccessToken(user);
  }

  async verify2fa(dto: Verify2faDto) {
    const payload = this.decodeTempToken(dto.tempToken, '2fa_verify');
    const user = await this.findUserOrThrow(payload.sub);

    if (!user.google2fa_secret) {
      throw new BadRequestException('2FA is not set up for this account.');
    }

    const isValid = authenticator.check(dto.code, user.google2fa_secret);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code.');
    }

    return this.issueAccessToken(user);
  }

  private issueAccessToken(user: any) {
    const accessToken = this.jwt.sign(
      {
        sub: Number(user.id),
        role: user.role,
        stage: 'authenticated',
      },
      { expiresIn: ACCESS_TOKEN_TTL },
    );
    return { accessToken, user: this.sanitizeUser(user) };
  }

  private decodeTempToken(
    token: string,
    expectedStage: TempTokenPayload['stage'],
  ): TempTokenPayload {
    let payload: TempTokenPayload;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new UnauthorizedException('Session expired, please log in again.');
    }
    if (payload.stage !== expectedStage) {
      throw new UnauthorizedException('Invalid session for this step.');
    }
    return payload;
  }

  private async findUserOrThrow(id: number) {
    const user = await this.prisma.users.findUnique({ where: { id } });
    if (!user) {
      throw new UnauthorizedException('Account no longer exists.');
    }
    return user;
  }
}
