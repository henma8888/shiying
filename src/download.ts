import type { ErrorKind } from "./copy";
import { deliveryMode, mediaFilename, type MediaItem } from "./media";
import { COBALT_APIS } from "./resolve";

export class MediaError extends Error {
  kind: ErrorKind;

  constructor(kind: ErrorKind) {
    super(kind);
    this.name = "MediaError";
    this.kind = kind;
  }
}

const EXTRA_HOSTS = [".cdninstagram.com", ".fbcdn.net", ".giphy.com", ".tenor.com"];

export function isAllowedMediaUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "cdninstagram.com" || host === "giphy.com" || host === "tenor.com") return true;
  if (EXTRA_HOSTS.some((suffix) => host.endsWith(suffix))) return true;
  return COBALT_APIS.some((api) => {
    try {
      return new URL(api).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
}

function extension(contentType: string, rawUrl: string, kind: MediaItem["kind"]): string {
  const type = contentType.toLowerCase();
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  try {
    const match = new URL(rawUrl).pathname.match(/\.([a-z0-9]{2,4})$/i);
    if (match?.[1]) {
      const ext = match[1].toLowerCase();
      return ext === "jpeg" ? "jpg" : ext;
    }
  } catch {
    /* keep the kind fallback */
  }
  return kind === "video" ? "mp4" : "jpg";
}

async function readFile(
  item: MediaItem,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; ext: string }> {
  if (!isAllowedMediaUrl(item.url)) throw new MediaError("unavailable");
  const response = await fetchImpl(item.url, { signal });
  if (!response.ok) throw new MediaError(response.status === 429 ? "rate" : "network");
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new MediaError("unavailable");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new MediaError("network");
  return { bytes, ext: extension(type, item.url, item.kind) };
}

export type SavedFile = { blob: Blob; filename: string };

function blobType(ext: string): string {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mov") return "video/quicktime";
  return "application/octet-stream";
}

export async function packageMedia(
  items: MediaItem[],
  baseName: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<SavedFile[]> {
  const mode = deliveryMode(items.length);
  if (mode === "none") throw new MediaError("empty");

  const files = [];
  for (const item of items) {
    files.push(await readFile(item, fetchImpl, signal));
  }

  return files.map((file, index) => {
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    return {
      blob: new Blob([copy], { type: blobType(file.ext) }),
      filename: mediaFilename(baseName, index, files.length, file.ext),
    };
  });
}

export function saveVideoAsFile(userAgent: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function attachmentBlob(blob: Blob, saveAsFile: boolean): Blob {
  if (!saveAsFile || !blob.type.startsWith("video/")) return blob;
  return new Blob([blob], { type: "application/octet-stream" });
}

export function baseNameFor(service: string, code: string | null): string {
  const safeCode = (code ?? "post").replace(/[^A-Za-z0-9_-]/g, "");
  return `shiying_${service}_${safeCode || "post"}`;
}
