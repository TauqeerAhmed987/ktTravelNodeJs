import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET) redirects to the web app', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(302)
      .expect('Location', process.env.WEB_APP_URL ?? 'http://localhost:3001');
  });

  afterEach(async () => {
    await app.close();
  });
});
