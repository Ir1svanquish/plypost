import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parser } from "stream-json";
import type { Token } from "stream-json/parser.js";
import { MAX_IMAGE_BYTES, MAX_OWNER_MEDIA_BYTES, MAX_OWNER_MEDIA_COUNT } from "./media";
import { MAX_VIDEO_BYTES, MAX_OWNER_VIDEO_BYTES, MAX_OWNER_VIDEO_COUNT } from "./video";
import { BackupError, DecodedBackupAsset, MAX_PORTABLE_BACKUP_BYTES } from "./portable-backup";

type AssetKind = "media" | "videos";
type ObjectFrame = { kind: "object"; value: Record<string, unknown>; key: string | null; assetKind?: AssetKind };
type ArrayFrame = { kind: "array"; value: unknown[]; assetKind?: AssetKind };
type Frame = ObjectFrame | ArrayFrame;

const invalid = (message = "Backup is not valid UTF-8 JSON."): never => { throw new BackupError(message); };

class Base64Body {
  private bytes: Buffer;
  private size = 0;
  private carry = "";
  private encodedLength = 0;
  private padding = 0;
  private lastQuad = "";

  constructor(private readonly maxBytes: number, private readonly expectedSize: number | null) {
    this.bytes = Buffer.allocUnsafe(expectedSize ?? 0);
  }

  write(chunk: string) {
    if (!/^[A-Za-z0-9+/=]*$/.test(chunk)) invalid("Backup contains invalid image or video data.");
    const firstPadding = chunk.indexOf("=");
    if (this.padding && /[^=]/.test(chunk)) invalid("Backup contains invalid image or video data.");
    if (firstPadding !== -1) {
      if (/[^=]/.test(chunk.slice(firstPadding))) invalid("Backup contains invalid image or video data.");
      this.padding += chunk.length - firstPadding;
      if (this.padding > 2) invalid("Backup contains invalid image or video data.");
    }
    this.encodedLength += chunk.length;
    if (this.encodedLength > Math.ceil(this.maxBytes / 3) * 4) {
      invalid("Backup image or video exceeds its file limit.");
    }
    const text = this.carry + chunk;
    const completeLength = text.length - text.length % 4;
    const complete = text.slice(0, completeLength);
    this.carry = text.slice(completeLength);
    if (!complete) return;
    this.lastQuad = complete.slice(-4);
    const decoded = Buffer.from(complete, "base64");
    const needed = this.size + decoded.length;
    if (needed > this.maxBytes || (this.expectedSize !== null && needed > this.expectedSize)) {
      invalid("Backup image or video exceeds its file limit.");
    }
    if (needed > this.bytes.length) {
      const grown = Buffer.allocUnsafe(Math.min(this.maxBytes, Math.max(64 * 1024, needed, this.bytes.length * 2)));
      this.bytes.copy(grown, 0, 0, this.size);
      this.bytes = grown;
    }
    decoded.copy(this.bytes, this.size);
    this.size = needed;
  }

  finish(): Buffer {
    if (this.carry || !this.encodedLength || this.encodedLength % 4 ||
        !this.lastQuad || Buffer.from(this.lastQuad, "base64").toString("base64") !== this.lastQuad ||
        (this.expectedSize !== null && this.size !== this.expectedSize)) {
      invalid("Backup contains invalid image or video data.");
    }
    if (this.size === this.bytes.length) return this.bytes;
    return Buffer.from(this.bytes.subarray(0, this.size));
  }
}

class BackupAssembler {
  private root: unknown;
  private stack: Frame[] = [];
  private active: "key" | "string" | "number" | null = null;
  private pieces: string[] = [];
  private valueSize = 0;
  private ordinaryCharacters = 0;
  private tokens = 0;
  private body: Base64Body | null = null;
  private assetBytes = { media: 0, videos: 0 };

  private attach(value: unknown) {
    const parent = this.stack.at(-1);
    if (!parent) {
      if (this.root !== undefined) invalid();
      this.root = value;
      return;
    }
    if (parent.kind === "array") {
      const maxCount = parent.assetKind === "media" ? MAX_OWNER_MEDIA_COUNT :
        parent.assetKind === "videos" ? MAX_OWNER_VIDEO_COUNT : 10_000;
      if (parent.value.length >= maxCount) invalid("Backup contains too many items.");
      parent.value.push(value);
      return;
    }
    const key = parent.key;
    if (key === null) throw new BackupError("Backup is not valid UTF-8 JSON.");
    if (Object.hasOwn(parent.value, key)) invalid("Backup contains duplicate JSON fields.");
    Object.defineProperty(parent.value, key, { value, enumerable: true, writable: true, configurable: true });
    parent.key = null;
  }

  private begin(type: "object" | "array") {
    if (this.stack.length >= 32) invalid("Backup JSON is nested too deeply.");
    const parent = this.stack.at(-1);
    const assetKind = parent?.kind === "array" ? parent.assetKind : undefined;
    const listKind = parent?.kind === "object" && this.stack.length === 1 &&
      (parent.key === "media" || parent.key === "videos") ? parent.key : undefined;
    if (type === "object") {
      const value: Record<string, unknown> = {};
      this.attach(value);
      this.stack.push({ kind: "object", value, key: null, assetKind });
    } else {
      const value: unknown[] = [];
      this.attach(value);
      this.stack.push({ kind: "array", value, assetKind: listKind });
    }
  }

  private end(type: "object" | "array") {
    const top = this.stack.pop();
    if (!top || top.kind !== type || (top.kind === "object" && top.key !== null)) invalid();
  }

  accept(token: Token) {
    this.tokens++;
    if (this.tokens > 1_000_000) invalid("Backup contains too many JSON values.");
    switch (token.name) {
      case "startObject": this.begin("object"); break;
      case "endObject": this.end("object"); break;
      case "startArray": this.begin("array"); break;
      case "endArray": this.end("array"); break;
      case "startKey":
      case "startString":
      case "startNumber": {
        if (this.active !== null) invalid();
        this.active = token.name === "startKey" ? "key" : token.name === "startString" ? "string" : "number";
        this.pieces = [];
        this.valueSize = 0;
        const top = this.stack.at(-1);
        if (this.active === "string" && top?.kind === "object" && top.assetKind && top.key === "base64") {
          const max = top.assetKind === "media" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
          const declared = top.value.sizeBytes;
          this.body = new Base64Body(max, Number.isInteger(declared) && (declared as number) >= 0 &&
            (declared as number) <= max ? declared as number : null);
        }
        break;
      }
      case "stringChunk":
      case "numberChunk": {
        if (!this.active || (token.name === "numberChunk") !== (this.active === "number")) invalid();
        const value = token.value;
        if (this.body) this.body.write(value);
        else {
          this.valueSize += value.length;
          this.ordinaryCharacters += value.length;
          if (this.valueSize > (this.active === "key" ? 128 : this.active === "number" ? 128 : 1_000_000) ||
              this.ordinaryCharacters > 16 * 1024 * 1024) invalid("Backup text is too large.");
          this.pieces.push(value);
        }
        break;
      }
      case "endKey": {
        if (this.active !== "key") invalid();
        const top = this.stack.at(-1);
        if (!top || top.kind !== "object" || top.key !== null) throw new BackupError("Backup is not valid UTF-8 JSON.");
        const key = this.pieces.join("");
        if (Object.hasOwn(top.value, key)) invalid("Backup contains duplicate JSON fields.");
        top.key = key;
        this.active = null;
        break;
      }
      case "endString": {
        if (this.active !== "string") invalid();
        if (this.body) {
          const top = this.stack.at(-1) as ObjectFrame;
          const bytes = this.body.finish();
          const kind = top.assetKind!;
          this.assetBytes[kind] += bytes.length;
          if (this.assetBytes[kind] > (kind === "media" ? MAX_OWNER_MEDIA_BYTES : MAX_OWNER_VIDEO_BYTES)) {
            invalid("Backup images or videos exceed the library limit.");
          }
          this.attach(new DecodedBackupAsset(bytes));
          this.body = null;
        } else this.attach(this.pieces.join(""));
        this.active = null;
        break;
      }
      case "endNumber":
        if (this.active !== "number") invalid();
        this.attach(Number(this.pieces.join("")));
        this.active = null;
        break;
      case "nullValue": this.attach(null); break;
      case "trueValue": this.attach(true); break;
      case "falseValue": this.attach(false); break;
      default: invalid();
    }
  }

  finish(): unknown {
    if (this.stack.length || this.active || !this.root || typeof this.root !== "object" || Array.isArray(this.root)) invalid();
    return this.root;
  }
}

export async function parsePortableBackupRequest(request: Request): Promise<unknown> {
  const claimedLength = request.headers.get("content-length");
  if (claimedLength && /^\d+$/.test(claimedLength) && Number(claimedLength) > MAX_PORTABLE_BACKUP_BYTES) {
    throw new BackupError("Backup exceeds the 192 MiB portable archive limit.", 413);
  }
  if (!request.body) invalid("Backup file is empty.");
  const assembled = new BackupAssembler();
  let total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > MAX_PORTABLE_BACKUP_BYTES) {
        callback(new BackupError("Backup exceeds the 192 MiB portable archive limit.", 413));
        return;
      }
      try { decoder.decode(chunk, { stream: true }); callback(null, chunk); }
      catch { callback(new BackupError("Backup is not valid UTF-8 JSON.")); }
    },
    flush(callback) {
      try { decoder.decode(); callback(); }
      catch { callback(new BackupError("Backup is not valid UTF-8 JSON.")); }
    },
  });
  const sink = new Writable({ objectMode: true, write(token: Token, _encoding, callback) {
    try { assembled.accept(token); callback(); }
    catch (error) { callback(error as Error); }
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as never), limit,
      parser.asStream({ packKeys: false, packStrings: false, packNumbers: false }), sink,
      { signal: request.signal });
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (request.signal.aborted) throw new BackupError("Backup restore was cancelled.");
    throw new BackupError("Backup is not valid UTF-8 JSON.");
  }
  if (!total) invalid("Backup file is empty.");
  return assembled.finish();
}
