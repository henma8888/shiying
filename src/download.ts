import { zipSync } from "fflate";
import type { ErrorKind } from "./copy";
import { deliveryMode, type MediaItem } from "./media";
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

export async function packageMedia(
  items: MediaItem[],
  baseName: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blob: Blob; filename: string }> {
  const mode = deliveryMode(items.length);
  if (mode === "none") throw new MediaError("empty");

  const files = [];
  for (const item of items) {
    files.push(await readFile(item, fetchImpl, signal));
  }

  if (mode === "single") {
    const file = files[0];
    if (!file) throw new MediaError("empty");
    const copy = new Uint8Array(file.bytes.byteLength);
    copy.set(file.bytes);
    return {
      blob: new Blob([copy], { type: file.ext === "jpg" ? "image/jpeg" : file.ext === "mp4" ? "video/mp4" : "application/octet-stream" }),
      filename: `${baseName}.${file.ext}`,
    };
  }

  const archive: Record<string, Uint8Array> = {};
  files.forEach((file, index) => {
    archive[`${String(index + 1).padStart(2, "0")}.${file.ext}`] = file.bytes;
  });
  const zipped = zipSync(archive, { level: 0 });
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  return {
    blob: new Blob([copy], { type: "application/zip" }),
    filename: `${baseName}.zip`,
  };
}

export function baseNameFor(service: string, code: string | null): string {
  const safeCode = (code ?? "post").replace(/[^A-Za-z0-9_-]/g, "");
  return `shiying_${service}_${safeCode || "post"}`;
}
