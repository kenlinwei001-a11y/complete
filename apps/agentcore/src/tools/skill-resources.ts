import { readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { SkillDefinition } from "@platform/contracts";

type SkillResource = SkillDefinition["resources"][number];

/**
 * 增量 §3：read_skill_resource 的附件内容端口。
 * 文本类返回 utf8 字符串内容；不可得（无存储/不存在）→ undefined。
 * 默认实现按 blobKey 读本地目录（与 DataCore BLOB_DIR 共享卷的部署形态）；
 * 测试注入内存实现。
 */
export interface SkillResourceReader {
  read(skill: SkillDefinition, resource: SkillResource): Promise<string | undefined>;
  /** 二进制附件元信息（可选）：字节数 */
  size?(skill: SkillDefinition, resource: SkillResource): Promise<number | undefined>;
}

/** 本地文件系统实现（BLOB_DIR 卷共享形态）；路径穿越防护与 DataCore LocalFsBlobStore 同口径。 */
export class LocalFsSkillResourceReader implements SkillResourceReader {
  constructor(private readonly rootDir: string) {}

  private pathFor(blobKey: string): string {
    const safe = normalize(blobKey).replace(/^(\.\.[/\\])+/, "");
    if (safe.includes("..")) throw new Error("invalid blob key");
    return join(this.rootDir, safe);
  }

  async read(_skill: SkillDefinition, resource: SkillResource): Promise<string | undefined> {
    try {
      return await readFile(this.pathFor(resource.blobKey), "utf8");
    } catch {
      return undefined;
    }
  }

  async size(_skill: SkillDefinition, resource: SkillResource): Promise<number | undefined> {
    try {
      return (await stat(this.pathFor(resource.blobKey))).size;
    } catch {
      return undefined;
    }
  }
}

/** 测试/演示用内存实现：blobKey → 内容。 */
export class InMemorySkillResourceReader implements SkillResourceReader {
  constructor(private readonly blobs: Record<string, string | Buffer> = {}) {}

  set(blobKey: string, content: string | Buffer): void {
    this.blobs[blobKey] = content;
  }

  async read(_skill: SkillDefinition, resource: SkillResource): Promise<string | undefined> {
    const v = this.blobs[resource.blobKey];
    if (v === undefined) return undefined;
    return typeof v === "string" ? v : v.toString("utf8");
  }

  async size(_skill: SkillDefinition, resource: SkillResource): Promise<number | undefined> {
    const v = this.blobs[resource.blobKey];
    if (v === undefined) return undefined;
    return typeof v === "string" ? Buffer.byteLength(v, "utf8") : v.length;
  }
}
