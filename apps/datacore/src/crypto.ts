import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** AES-256-GCM credential encryption (PRD §11). Key = 32-byte hex from CREDENTIAL_KEY;
 *  non-64-hex values are stretched to 32 bytes via SHA-256. */
export class CredentialCipher {
  private key: Buffer;

  constructor(keyMaterial: string) {
    if (/^[0-9a-fA-F]{64}$/.test(keyMaterial)) {
      this.key = Buffer.from(keyMaterial, "hex");
    } else {
      this.key = createHash("sha256").update(keyMaterial, "utf8").digest();
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
      throw new Error("invalid encrypted payload");
    }
    const iv = Buffer.from(parts[2] as string, "base64");
    const tag = Buffer.from(parts[3] as string, "base64");
    const ct = Buffer.from(parts[4] as string, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }

  static isEncrypted(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("enc:v1:");
  }
}
