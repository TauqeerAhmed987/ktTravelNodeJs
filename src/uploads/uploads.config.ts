import { join } from 'path';

// Where uploaded images live on disk. Set UPLOADS_DIR to a PERSISTENT location in production
// (a mounted volume / a folder outside the deployed code): a redeploy replaces the app folder, so
// files kept inside it (the default ./uploads) disappear. Read lazily so .env is already loaded.
export function getUploadsDir(): string {
  return process.env.UPLOADS_DIR ? process.env.UPLOADS_DIR : join(process.cwd(), 'uploads');
}
