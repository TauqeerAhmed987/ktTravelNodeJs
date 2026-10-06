import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module.js';
import { getUploadsDir } from './uploads/uploads.config.js';

// All BigInt columns in this DB (mostly auto-increment ids) fit well within
// Number's safe integer range — this lets JSON.stringify handle them app-wide
// instead of hand-sanitizing every response.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3001' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const uploadsDir = getUploadsDir();
  mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/', maxAge: '7d' });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

