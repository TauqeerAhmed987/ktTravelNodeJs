import { AppController } from './app.controller.js';

describe('AppController', () => {
  it('redirects the root to the web app', () => {
    process.env.WEB_APP_URL = 'http://localhost:3001';
    expect(new AppController().redirectToWebApp()).toEqual({
      url: 'http://localhost:3001',
    });
  });
});
   