import { errorMessage, type ErrorKind } from "./copy";
import { extractFromHtml } from "./extract";
import { classify, signalsFromHtml } from "./errors";
import type { MediaItem } from "./media";
import { parseInput, type ParsedLink, type Service } from "./url";

export const COBALT_APIS = ["https://cobaltapi.cjs.nz/"];
const JINA_PREFIX = "https://r.jina.ai/";

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

async function readPublicPage(
  pageUrl: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<{ status: number; html: string; network: boolean }> {
  try {
    const response = await fetchImpl(`${JINA_PREFIX}${pageUrl}`, {
      headers: {
        Accept: "text/html",
        "X-Return-Format": "html",
      },
      signal,
    });
    const html = await response.text();
    return { status: response.status, html, network: false };
  } catch (error) {
    if (isAbort(error)) throw error;
    return { status: 0, html: "", network: true };
  }
}

function fromPage(html: string, code: string | null, cobaltCode: string | null, httpStatus: number): ResolveResult | { items: MediaItem[] } {
  let extracted = extractFromHtml(html, code);
  if (!extracted.items.length) {
    const ogUrl = html.match(/property=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1];
    if (ogUrl) {
      const parsed = parseInput(ogUrl.replace(/&amp;/g, "&"));
      if (parsed.ok && parsed.code && parsed.code !== code) {
        const again = extractFromHtml(html, parsed.code);
        if (again.items.length) extracted = again;
      }
    }
  }
  if (extracted.items.length) return { items: extracted.items };
  const error = classify({
    ...signalsFromHtml(html),
    cobaltCode,
    httpStatus,
    postFound: extracted.postFound,
  });
  return failure(error);
}

export async function resolvePost(
  input: string,
  options?: { signal?: AbortSignal; fetchImpl?: FetchLike },
): Promise<ResolveResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const parsed: ParsedLink = parseInput(input);
  if (!parsed.ok) return failure(classify({ parsed: "invalid" }));
  if (parsed.kind === "story") return failure(classify({ parsed: "story" }));

  if (parsed.service === "instagram") {
    const cobalt = await askCobalt(parsed.canonical, fetchImpl, options?.signal);
    const cobaltCode = cobalt.body?.error?.code ?? null;
    if (!cobalt.network && cobalt.body && !cobaltCode) {
      const items = itemsFromCobalt(cobalt.body);
      if (items === "remux") return failure("remux");
      if (items && items.length) {
        return {
          ok: true,
          service: parsed.service,
          code: parsed.code,
          canonical: parsed.canonical,
          items,
        };
      }
    }

    const page = await readPublicPage(parsed.canonical, fetchImpl, options?.signal);
    if (page.network && cobalt.network) return failure("network");
    if (page.status === 429 && !page.html) return failure("rate");
    const pageResult = fromPage(page.html, parsed.code, cobaltCode, page.status || cobalt.status);
    if ("items" in pageResult) {
      return {
        ok: true,
        service: parsed.service,
        code: parsed.code,
        canonical: parsed.canonical,
        items: pageResult.items,
      };
    }
    if (page.network && (cobalt.status === 429 || cobaltCode?.includes("rate"))) return failure("rate");
    return pageResult;
  }

  const page = await readPublicPage(parsed.canonical, fetchImpl, options?.signal);
  if (page.network) return failure("network");
  if (page.status === 429 && !page.html) return failure("rate");
  const pageResult = fromPage(page.html, parsed.code, null, page.status);
  if ("items" in pageResult) {
    return {
      ok: true,
      service: parsed.service,
      code: parsed.code,
      canonical: parsed.canonical,
      items: pageResult.items,
    };
  }
  return pageResult;
}
