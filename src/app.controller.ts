import { Controller, Get, Redirect } from '@nestjs/common';

@Controller()
export class AppController {
  // The API has no landing page — send browsers hitting the root to the web app.
  @Get()
  @Redirect()
  redirectToWebApp() {
    return { url: process.env.WEB_APP_URL ?? 'http://localhost:3001' };
  }
}
