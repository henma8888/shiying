import { errorMessage, type ErrorKind } from "./copy";
import { extractFromHtml } from "./extract";
import { classify, signalsFromHtml } from "./errors";
import type { MediaItem } from "./media";
import { parseInput, type ParsedLink, type Service } from "./url";

export const COBALT_APIS = ["https://cobaltapi.cjs.nz/"];
const JINA_PREFIX = "https://r.jina.ai/";
const MICROLINK_PREFIX = "https://api.microlink.io/?url=";

export type ResolveResult =
  | { ok: true; service: Service; code: string | null; canonical: string; items: MediaItem[] }
  | { ok: false; error: ErrorKind; message: string };

type FetchLike = typeof fetch;

type CobaltBody = {
  status?: string;
  url?: string;
  filename?: string;
  type?: string;
  tunnel?: string[];
  picker?: { type?: string; url?: string; thumb?: string }[];
  error?: { code?: string };
};

function failure(error: ErrorKind): ResolveResult {
  return { ok: false, error, message: errorMessage[error] };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function kindFromHint(hint: string | undefined, fallback: MediaItem["kind"]): MediaItem["kind"] {
  if (!hint) return fallback;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(hint) || /video/i.test(hint)) return "video";
  return "photo";
}

function itemsFromCobalt(body: CobaltBody): MediaItem[] | "remux" | null {
  if (body.status === "tunnel" || body.status === "redirect") {
    if (!body.url) return null;
    const kind = kindFromHint(body.filename ?? body.url, "video");
    return [{ kind, url: body.url }];
  }
  if (body.status === "picker" && Array.isArray(body.picker)) {
    return body.picker
      .filter((item) => item.url && item.type !== "audio")
      .map((item) => {
        const kind = item.type === "video" ? "video" : kindFromHint(item.url, "photo");
        return {
          kind,
          url: item.url as string,
          ...(item.thumb ? { thumb: item.thumb } : {}),
        } satisfies MediaItem;
      });
  }
  if (body.status === "local-processing") {
    if (body.type === "merge" || body.type === "remux" || body.type === "mute") return "remux";
    const url = body.tunnel?.find((item) => typeof item === "string");
    if (!url) return null;
    return [{ kind: kindFromHint(url, "video"), url }];
  }
  return null;
}

async function askCobalt(
  pageUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<{ status: number; body: CobaltBody | null; network: boolean }> {
  let lastNetwork = false;
  for (const api of COBALT_APIS) {
    try {
      const response = await fetchImpl(api, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pageUrl,
          alwaysProxy: true,
          downloadMode: "auto",
          filenameStyle: "basic",
        }),
        signal,
      });
      const body = (await response.json().catch(() => null)) as CobaltBody | null;
      if (body?.error?.code === "error.api.auth.jwt.missing") continue;
      return { status: response.status, body, network: false };
    } catch (error) {
      if (isAbort(error)) throw error;
      lastNetwork = true;
    }
  }
  return { status: 0, body: null, network: lastNetwork };
}

type PageRead = { status: number; html: string; blocked: boolean; network: boolean };

function isBlockedPage(status: number, html: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  return /AuthenticationRequiredError|bad IP reputation/i.test(html.slice(0, 1500));
}

function hardStop(html: string): ErrorKind | null {
  const signals = signalsFromHtml(html);
  if (
    (signals.restrictedAge != null && signals.restrictedAge >= 18) ||
    signals.failureReason === "MA" ||
    /Age-restricted content/i.test(html)
  ) {
    return "age";
  }
  if (signals.privateAccount) return "private";
  if (/available to everyone/i.test(html)) return "unavailable";
  if (signals.unavailable) return "deleted";
  return null;
}

function linkedPost(html: string): { code: string | null; url: string | null } {
  const decoded = html.replace(/&#0*64;/g, "@").replace(/\\u0040/g, "@");
  const og = decoded.match(/property=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? decoded.match(/rel=["']canonical["'] href=["']([^"']+)["']/i)?.[1];
  if (og) {
    const parsed = parseInput(og.replace(/&amp;/g, "&"));
    if (parsed.ok && parsed.code) return { code: parsed.code, url: parsed.canonical };
  }
  const shortcode = decoded.match(/shortcode=([A-Za-z0-9_-]+)/)?.[1]
    ?? decoded.match(/"shortcode":"([A-Za-z0-9_-]+)"/)?.[1]
    ?? null;
  const vanity = decoded.match(/"vanity_username":"([^"]+)"/)?.[1]?.replace(/^@/, "") ?? null;
  if (shortcode && vanity) {
    return { code: shortcode, url: `https://www.threads.com/@${vanity}/post/${shortcode}` };
  }
  if (shortcode) return { code: shortcode, url: `https://www.threads.com/t/${shortcode}` };
  return { code: null, url: null };
}

function mediaFromHtml(html: string, code: string | null): MediaItem[] {
  let items = extractFromHtml(html, code).items;
  const linked = linkedPost(html);
  if (linked.code && linked.code !== code) {
    const again = extractFromHtml(html, linked.code).items;
    if (again.length > items.length) items = again;
  }
  return items;
}

async function readPublicPage(
  pageUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<PageRead> {
  try {
    const response = await fetchImpl(`${JINA_PREFIX}${pageUrl}`, {
      headers: {
        Accept: "text/html",
        "X-Return-Format": "html",
      },
      signal,
    });
    const html = await response.text();
    const blocked = isBlockedPage(response.status, html);
    return { status: response.status, html: blocked ? "" : html, blocked, network: false };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { status: 0, html: "", blocked: false, network: true };
  }
}

function embedUrl(canonical: string, service: Service): string | null {
  if (service !== "instagram") return null;
  return canonical.endsWith("/") ? `${canonical}embed/` : `${canonical}/embed/`;
}

function pageCandidates(parsed: Extract<ParsedLink, { ok: true }>): string[] {
  const embed = embedUrl(parsed.canonical, parsed.service);
  if (!embed) return [parsed.canonical];
  if (parsed.canonical.includes("/share/")) return [parsed.canonical, embed];
  return [embed, parsed.canonical];
}

async function readMicrolink(
  pageUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<{ items: MediaItem[]; blocked: boolean }> {
  try {
    const response = await fetchImpl(`${MICROLINK_PREFIX}${encodeURIComponent(pageUrl)}`, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      return { items: [], blocked: true };
    }
    if (!response.ok) return { items: [], blocked: false };
    const body = (await response.json()) as {
      data?: {
        image?: { url?: string; width?: number } | null;
        video?: { url?: string } | string | null;
      };
    };
    const image = body.data?.image;
    const video = body.data?.video;
    const videoUrl = typeof video === "string" ? video : video?.url;
    if (videoUrl && /^https:\/\//.test(videoUrl)) {
      const thumb = image?.url && (image.width ?? 0) > 200 ? image.url : undefined;
      return { items: [{ kind: "video", url: videoUrl, ...(thumb ? { thumb } : {}) }], blocked: false };
    }
    if (image?.url && /^https:\/\//.test(image.url) && (image.width ?? 0) > 200 && !/s150x150|\/t51\.[^/]*-19\//.test(image.url)) {
      return { items: [{ kind: "photo", url: image.url, thumb: image.url }], blocked: false };
    }
    return { items: [], blocked: false };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { items: [], blocked: false };
  }
}

export async function resolvePost(
  input: string,
  options?: { signal?: AbortSignal; fetchImpl?: FetchLike },
): Promise<ResolveResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const parsed: ParsedLink = parseInput(input);
  if (!parsed.ok) return failure(classify({ parsed: "invalid" }));
  if (parsed.kind === "story") return failure(classify({ parsed: "story" }));

  let cobaltCode: string | null = null;
  let sawNetwork = false;
  let sawBlock = false;
  let sawHtml = false;
  let bestItems: MediaItem[] = [];

  if (parsed.service === "instagram") {
    const cobalt = await askCobalt(parsed.canonical, fetchImpl, options?.signal);
    cobaltCode = cobalt.body?.error?.code ?? null;
    if (cobalt.network) sawNetwork = true;
    if (!cobalt.network && cobalt.body && !cobaltCode) {
      const items = itemsFromCobalt(cobalt.body);
      if (items === "remux") return failure("remux");
      if (items && items.length > 1) {
        return {
          ok: true,
          service: parsed.service,
          code: parsed.code,
          canonical: parsed.canonical,
          items,
        };
      }
      if (items?.length === 1 && !items.some((item) => item.kind === "video")) bestItems = items;
      if (items?.some((item) => item.kind === "video")) {
        return {
          ok: true,
          service: parsed.service,
          code: parsed.code,
          canonical: parsed.canonical,
          items,
        };
      }
    }
  }

  const seenPages = new Set<string>();
  const queue = [...pageCandidates(parsed)];
  for (let index = 0; index < queue.length && index < 4; index += 1) {
    const pageUrl = queue[index];
    if (!pageUrl || seenPages.has(pageUrl)) continue;
    seenPages.add(pageUrl);
    const page = await readPublicPage(pageUrl, fetchImpl, options?.signal);
    if (page.blocked) {
      sawBlock = true;
      continue;
    }
    if (page.network) {
      sawNetwork = true;
      continue;
    }
    if (page.html) sawHtml = true;
    const stopped = hardStop(page.html);
    if (stopped) return failure(stopped);
    const items = mediaFromHtml(page.html, parsed.code);
    const linked = linkedPost(page.html);
    if (linked.url && !seenPages.has(linked.url) && items.length <= 1) queue.push(linked.url);
    if (items.length > bestItems.length) bestItems = items;
    if (bestItems.length > 1 || bestItems.some((item) => item.kind === "video")) {
      return {
        ok: true,
        service: parsed.service,
        code: parsed.code,
        canonical: parsed.canonical,
        items: bestItems,
      };
    }
  }

  if (bestItems.length) {
    return {
      ok: true,
      service: parsed.service,
      code: parsed.code,
      canonical: parsed.canonical,
      items: bestItems,
    };
  }

  const microlink = await readMicrolink(parsed.canonical, fetchImpl, options?.signal);
  if (microlink.blocked) sawBlock = true;
  if (microlink.items.length) {
    return {
      ok: true,
      service: parsed.service,
      code: parsed.code,
      canonical: parsed.canonical,
      items: microlink.items,
    };
  }

  if (sawBlock) return failure("rate");
  if (sawNetwork && !sawHtml) return failure("network");
  return failure(classify({ cobaltCode, postFound: false }));
}
