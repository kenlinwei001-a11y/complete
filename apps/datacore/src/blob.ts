import { mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/** BlobStore abstraction (PRD §1.3) — local fs now, interface ready for S3. */
export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export class LocalFsBlobStore implements BlobStore {
  constructor(private rootDir: string) {}

  private pathFor(key: string): string {
    const safe = normalize(key).replace(/^(\.\.[/\\])+/, "");
    if (safe.includes("..")) throw new Error("invalid blob key");
    return join(this.rootDir, safe);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
