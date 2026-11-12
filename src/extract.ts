import type { MediaItem } from "./media";

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

export type Extracted = {
  items: MediaItem[];
  postFound: boolean;
};

function walk(node: Json, visit: (object: Record<string, Json>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node && typeof node === "object") {
    visit(node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html: string, property: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (key !== property) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return decodeHtml(content);
  }
  return null;
}

function isDirectMedia(url: string): boolean {
  return /cdninstagram\.com|fbcdn\.net|giphy\.com|tenor\.com|\.(mp4|jpe?g|png|webp|gif)(\?|$)/i.test(url);
}

function isSkippableImage(url: string): boolean {
  return /static\.cdninstagram\.com|rsrc\.php|s150x150|\/t51\.[^/]*-19\//.test(url);
}

function asRecord(value: Json | undefined): Record<string, Json> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function bestImage(node: Record<string, Json>): string | null {
  const versions = asRecord(node.image_versions2);
  const candidates = versions?.candidates;
  if (!Array.isArray(candidates)) return null;
  const ranked = candidates
    .map((candidate) => {
      const record = asRecord(candidate);
      if (!record || typeof record.url !== "string") return null;
      return {
        url: record.url,
        width: typeof record.width === "number" ? record.width : 0,
      };
    })
    .filter((item): item is { url: string; width: number } => item !== null)
    .sort((a, b) => b.width - a.width);
  return ranked.find((item) => !isSkippableImage(item.url))?.url ?? ranked[0]?.url ?? null;
}

function bestVideo(node: Record<string, Json>): string | null {
  if (!Array.isArray(node.video_versions)) return null;
  const ranked = node.video_versions
    .map((candidate) => {
      const record = asRecord(candidate);
      if (!record || typeof record.url !== "string") return null;
      return {
        url: record.url,
        width: typeof record.width === "number" ? record.width : 0,
        bandwidth: typeof record.bandwidth === "number" ? record.bandwidth : 0,
      };
    })
    .filter((item): item is { url: string; width: number; bandwidth: number } => item !== null)
    .sort((a, b) => b.width - a.width || b.bandwidth - a.bandwidth || b.url.length - a.url.length);
  return ranked[0]?.url ?? null;
}

function gifUrl(node: Record<string, Json>): string | null {
  const info = node.giphy_media_info;
  if (!info || typeof info !== "object") return null;
  const stack: Json[] = [info];
  let depth = 0;
  while (stack.length && depth < 6) {
    const current = stack.shift();
    depth += 1;
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const value of Object.values(current)) {
      if (typeof value === "string" && /^https:\/\//.test(value)) {
        if (value.includes("giphy.com") || value.includes("tenor.com") || /\.gif(\?|$)/.test(value)) {
          return value;
        }
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return null;
}

function itemFromNode(node: Record<string, Json>): MediaItem | null {
  const video = bestVideo(node);
  if (video) {
    const thumb = bestImage(node);
    return thumb ? { kind: "video", url: video, thumb } : { kind: "video", url: video };
  }
  const image = bestImage(node);
  if (image) return { kind: "photo", url: image, thumb: image };
  const gif = gifUrl(node);
  if (gif) return { kind: "photo", url: gif, thumb: gif };
  return null;
}

function isPostNode(node: Record<string, Json>, code: string | null): boolean {
  if (!code || node.code !== code) return false;
  return (
    "image_versions2" in node ||
    "video_versions" in node ||
    "carousel_media" in node ||
    "media_type" in node
  );
}

function itemsFromNode(node: Record<string, Json>): MediaItem[] {
  const carousel = node.carousel_media;
  if (Array.isArray(carousel) && carousel.length) {
    return carousel
      .map((child) => {
        const record = asRecord(child);
        return record ? itemFromNode(record) : null;
      })
      .filter((item): item is MediaItem => item !== null);
  }
  const item = itemFromNode(node);
  return item ? [item] : [];
}

function fileKey(url: string): string {
  const path = url.split("?")[0] ?? url;
  return path.split("/").pop() || path;
}

function dedupe(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  const unique: MediaItem[] = [];
  for (const item of items) {
    const key = fileKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function peelEscapes(html: string): string {
  let text = html;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (/display_url":"https:\/\//.test(text) || /video_url":"https:\/\//.test(text)) break;
    const next = text.replace(/\\\//g, "/").replace(/\\"/g, '"');
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\%/g, "%");
}

function cleanMediaUrl(url: string): string {
  return url.replace(/\\u0026/g, "&").replace(/\\u0025/g, "%").replace(/&amp;/g, "&");
}

function parseObjectAfter(text: string, marker: string): Record<string, Json> | null {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as Record<string, Json>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function embeddedNode(node: Record<string, Json> | null): MediaItem | null {
  if (!node) return null;
  const video = typeof node.video_url === "string" ? cleanMediaUrl(node.video_url) : "";
  const image = typeof node.display_url === "string" ? cleanMediaUrl(node.display_url) : "";
  if (node.is_video === true && video) {
    return image && !isSkippableImage(image) ? { kind: "video", url: video, thumb: image } : { kind: "video", url: video };
  }
  if (image && isDirectMedia(image) && !isSkippableImage(image)) {
    return { kind: "photo", url: image, thumb: image };
  }
  return null;
}

function extractEmbeddedMedia(html: string): MediaItem[] {
  if (!html.includes("display_url") && !html.includes("video_url")) return [];
  const text = peelEscapes(html);
  const sidecar = parseObjectAfter(text, '"edge_sidecar_to_children"');
  const edges = sidecar ? asRecord(sidecar)?.edges : null;
  if (Array.isArray(edges) && edges.length) {
    const items = edges
      .map((edge) => {
        const record = asRecord(edge);
        return embeddedNode(record ? asRecord(record.node) : null);
      })
      .filter((item): item is MediaItem => item !== null);
    if (items.length) return dedupe(items);
  }
  const images = [...text.matchAll(/"display_url":"(https:\/\/[^"]+)"/g)]
    .map((match) => cleanMediaUrl(match[1] ?? ""))
    .filter((url) => url && isDirectMedia(url) && !isSkippableImage(url));
  if (images.length > 1) {
    return dedupe(images.map((url) => ({ kind: "photo" as const, url, thumb: url })));
  }
  const video = text.match(/"video_url":"(https:\/\/[^"]+)"/)?.[1];
  const image = text.match(/"display_url":"(https:\/\/[^"]+)"/)?.[1];
  if (video) {
    const cleanVideo = cleanMediaUrl(video);
    const cleanImage = image ? cleanMediaUrl(image) : "";
    return [
      cleanImage && !isSkippableImage(cleanImage)
        ? { kind: "video", url: cleanVideo, thumb: cleanImage }
        : { kind: "video", url: cleanVideo },
    ];
  }
  if (image) {
    const cleanImage = cleanMediaUrl(image);
    if (isDirectMedia(cleanImage) && !isSkippableImage(cleanImage)) {
      return [{ kind: "photo", url: cleanImage, thumb: cleanImage }];
    }
  }
  return [];
}

function markdownImages(html: string): MediaItem[] {
  const items: MediaItem[] = [];
  for (const match of html.matchAll(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = match[1];
    if (!url || isSkippableImage(url)) continue;
    if (/\.mp4(\?|$)/i.test(url)) items.push({ kind: "video", url });
    else items.push({ kind: "photo", url, thumb: url });
  }
  return dedupe(items);
}

export function extractFromHtml(html: string, code: string | null): Extracted {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const matches: Record<string, Json>[] = [];

  for (const script of scripts) {
    const source = script[1];
    if (!source) continue;
    let data: Json;
    try {
      data = JSON.parse(source) as Json;
    } catch {
      continue;
    }
    walk(data, (node) => {
      if (isPostNode(node, code)) matches.push(node);
    });
  }

  let postFound = matches.length > 0;
  let best: MediaItem[] = [];
  for (const node of matches) {
    const items = itemsFromNode(node);
    if (items.length > best.length) best = items;
  }

  if (!best.length) {
    best = extractEmbeddedMedia(html);
    if (best.length) postFound = true;
  }

  if (!best.length) {
    const video = metaContent(html, "og:video");
    const image = metaContent(html, "og:image");
    const directVideo = video && isDirectMedia(video) ? video : null;
    const directImage = image && isDirectMedia(image) && !isSkippableImage(image) ? image : null;
    if (directVideo) {
      best = [{ kind: "video", url: directVideo, ...(directImage ? { thumb: directImage } : {}) }];
    } else if (directImage) {
      best = [{ kind: "photo", url: directImage, thumb: directImage }];
    } else {
      best = markdownImages(html).filter((item) => isDirectMedia(item.url));
    }
    if (best.length) postFound = true;
  }

  return { items: dedupe(best), postFound };
}
