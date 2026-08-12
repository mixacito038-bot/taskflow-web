import { createHash } from "node:crypto";
import { mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

// R2 → 本地磁盘适配：对象内容存文件，customMetadata 存 .meta.json 边车；
// 实现平台用到的 put/get/head/delete/list({prefix, limit}) 接口。
// 对象键做哈希分桶存储，避免任意键造成路径穿越或超长文件名。
export class DiskR2Bucket {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.indexFile = path.join(rootDir, "objects-index.json");
    mkdirSync(rootDir, { recursive: true });
  }

  #fileFor(key) {
    const digest = createHash("sha256").update(key).digest("hex");
    return path.join(this.rootDir, digest.slice(0, 2), digest);
  }

  async #readIndex() {
    try {
      return JSON.parse(await fs.readFile(this.indexFile, "utf8"));
    } catch {
      return {};
    }
  }

  async #writeIndex(index) {
    await fs.mkdir(path.dirname(this.indexFile), { recursive: true });
    const tmp = `${this.indexFile}.tmp-${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(index));
    await fs.rename(tmp, this.indexFile);
  }

  async put(key, value, options = {}) {
    const bytes = typeof value === "string"
      ? Buffer.from(value)
      : value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(new Uint8Array(value));
    const filePath = this.#fileFor(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({
      key,
      size: bytes.byteLength,
      customMetadata: options.customMetadata ?? {},
      httpMetadata: options.httpMetadata ?? {},
      uploadedAt: new Date().toISOString(),
    }));
    const index = await this.#readIndex();
    index[key] = { size: bytes.byteLength };
    await this.#writeIndex(index);
    return { key, size: bytes.byteLength };
  }

  async #meta(key) {
    try {
      return JSON.parse(await fs.readFile(`${this.#fileFor(key)}.meta.json`, "utf8"));
    } catch {
      return null;
    }
  }

  async get(key) {
    const meta = await this.#meta(key);
    if (!meta) return null;
    const bytes = await fs.readFile(this.#fileFor(key));
    return {
      key,
      size: bytes.byteLength,
      customMetadata: { ...meta.customMetadata },
      httpMetadata: { ...meta.httpMetadata },
      body: Readable.toWeb(Readable.from(bytes)),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => bytes.toString("utf8"),
    };
  }

  async head(key) {
    const meta = await this.#meta(key);
    return meta ? { key, size: meta.size, customMetadata: { ...meta.customMetadata } } : null;
  }

  async delete(key) {
    await fs.rm(this.#fileFor(key), { force: true });
    await fs.rm(`${this.#fileFor(key)}.meta.json`, { force: true });
    const index = await this.#readIndex();
    if (index[key]) {
      delete index[key];
      await this.#writeIndex(index);
    }
  }

  async list(options = {}) {
    const prefix = options.prefix ?? "";
    const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
    const index = await this.#readIndex();
    const objects = Object.entries(index)
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, limit)
      .map(([key, value]) => ({ key, size: value.size }));
    return { objects, truncated: false };
  }
}
