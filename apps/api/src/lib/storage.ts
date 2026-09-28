/**
 * File storage behind a tiny interface, so the local-disk driver used on a single
 * server can later be swapped for S3 without touching routes.
 *
 * Local driver: files live in UPLOAD_DIR (a Docker volume in production, included
 * in backups) and are served by the API at /uploads/<key>.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { config } from '../config.js';

export interface Storage {
  put(prefix: string, ext: string, data: Buffer): Promise<string>; // returns key
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

const KEY_RE = /^[a-z]+\/[a-f0-9]{32}\.[a-z0-9]+$/;

export const isValidKey = (key: string) => KEY_RE.test(key);

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private path(key: string) {
    if (!isValidKey(key)) throw new Error('invalid storage key');
    const p = normalize(join(this.root, key));
    if (!p.startsWith(normalize(this.root))) throw new Error('invalid storage key');
    return p;
  }

  async put(prefix: string, ext: string, data: Buffer) {
    const key = `${prefix}/${randomBytes(16).toString('hex')}.${ext}`;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
    return key;
  }

  async get(key: string) {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    await unlink(this.path(key)).catch(() => {});
  }

  publicUrl(key: string) {
    return `${config.PUBLIC_URL}/uploads/${key}`;
  }
}

export const storage: Storage = new LocalStorage(resolve(config.UPLOAD_DIR));

/** Turn a stored public URL back into a key (to delete the old file on replace). */
export function keyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const i = url.indexOf('/uploads/');
  if (i < 0) return null;
  const key = url.slice(i + '/uploads/'.length);
  return isValidKey(key) ? key : null;
}
