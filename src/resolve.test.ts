import { describe, expect, it } from "vitest";
import { resolvePost } from "./resolve";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolvePost fallbacks", () => {
  it("uses the Instagram embed page when Cobalt has no media", async () => {
    const embed = JSON.stringify({
      edge_sidecar_to_children: {
        edges: [
          { node: { is_video: false, display_url: "https://scontent.cdninstagram.com/one.jpg" } },
          { node: { is_video: false, display_url: "https://scontent.cdninstagram.com/two.jpg" } },
        ],
      },
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cobaltapi.cjs.nz")) {
        return jsonResponse({ status: "error", error: { code: "error.api.fetch.empty" } }, 400);
      }
      if (url.includes("r.jina.ai") && url.includes("/embed/")) return new Response(embed, { status: 200 });
      if (url.includes("api.microlink.io")) throw new Error("microlink should not be needed");
      return new Response("shell", { status: 200 });
    }) as typeof fetch;

    const result = await resolvePost("https://www.instagram.com/p/Daf6oJXFB-e/", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.kind)).toEqual(["photo", "photo"]);
  });

  it("saves a Threads photo from the metadata fallback when the page reader is blocked", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("r.jina.ai")) {
        return new Response('{"error":"AuthenticationRequiredError","message":"bad IP reputation"}', { status: 401 });
      }
      if (url.includes("api.microlink.io")) {
        return jsonResponse({
          status: "success",
          data: {
            image: {
              url: "https://scontent.cdninstagram.com/v/t51.82787-15/thread-photo.jpg",
              width: 1080,
            },
          },
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const result = await resolvePost("https://www.threads.net/@mosseri/post/DDupwppSjcp?hl=en", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toEqual([
      {
        kind: "photo",
        url: "https://scontent.cdninstagram.com/v/t51.82787-15/thread-photo.jpg",
        thumb: "https://scontent.cdninstagram.com/v/t51.82787-15/thread-photo.jpg",
      },
    ]);
  });

  it("still refuses an age-gated embed instead of downloading a fallback image", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cobaltapi.cjs.nz")) {
        return jsonResponse({ status: "error", error: { code: "error.api.fetch.empty" } }, 400);
      }
      if (url.includes("api.microlink.io")) {
        return jsonResponse({
          status: "success",
          data: { image: { url: "https://scontent.cdninstagram.com/secret.jpg", width: 1080 } },
        });
      }
      return new Response('{"failure_reason":"MA","restricted_age":21}', { status: 200 });
    }) as typeof fetch;

    const result = await resolvePost("https://www.instagram.com/reel/DeWKlz2M4Rj/", { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("age");
  });
});
