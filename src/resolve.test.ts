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

  it("accepts a Threads share link that is not public and does not call it an empty clipboard", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("r.jina.ai")) {
        return new Response("<html>This content isn't available to everyone</html>", { status: 200 });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const parsed = await resolvePost("https://www.threads.com/share/BAYaW-I4W9/", { fetchImpl });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe("unavailable");
    expect(parsed.message).not.toContain("剪貼簿");
  });

  it("follows a Threads share page to every photo in the real post", async () => {
    const html = `
      <meta property="og:url" content="https://www.threads.com/@jin_hello/post/DfoWchtge4a" />
      <meta property="og:image" content="https://scontent.cdninstagram.com/only-one.jpg" />
      <script type="application/json">${JSON.stringify({
        code: "DfoWchtge4a",
        carousel_media: [1, 2, 3].map((n) => ({
          image_versions2: { candidates: [{ url: `https://scontent.cdninstagram.com/${n}.jpg`, width: 1000 }] },
        })),
      })}</script>`;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("r.jina.ai")) return new Response(html, { status: 200 });
      if (url.includes("api.microlink.io")) throw new Error("single preview should not replace the carousel");
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const result = await resolvePost("https://www.threads.com/share/BCQ20SsUU3/", { fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(3);
  });

  it("does not let img_index reduce an eight-photo embed to one file", async () => {
    const html = JSON.stringify({
      edge_sidecar_to_children: {
        edges: Array.from({ length: 8 }, (_, index) => ({
          node: { is_video: false, display_url: `https://scontent.cdninstagram.com/p${index + 1}.jpg` },
        })),
      },
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cobaltapi.cjs.nz")) {
        return jsonResponse({ status: "error", error: { code: "error.api.fetch.empty" } }, 400);
      }
      if (url.includes("/embed/")) return new Response(html, { status: 200 });
      if (url.includes("api.microlink.io")) throw new Error("microlink should not replace eight photos");
      return new Response("<html></html>", { status: 200 });
    }) as typeof fetch;
    const result = await resolvePost(
      "https://www.instagram.com/p/DfZSA2sDyEt/?img_index=8&mdxt=MWY2dXNob2N0bmhvcw==",
      { fetchImpl },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(8);
    expect(result.canonical.includes("img_index")).toBe(false);
  });

  it("refuses an age-restricted carousel instead of saving its single preview", async () => {
    const html = `<meta property="og:image" content="https://scontent.cdninstagram.com/only.jpg" /><span>Age-restricted content</span>`;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cobaltapi.cjs.nz")) {
        return jsonResponse({ status: "error", error: { code: "error.api.fetch.empty" } }, 400);
      }
      if (url.includes("api.microlink.io")) {
        return jsonResponse({
          status: "success",
          data: { image: { url: "https://scontent.cdninstagram.com/only.jpg", width: 1080 } },
        });
      }
      return new Response(html, { status: 200 });
    }) as typeof fetch;
    const result = await resolvePost("https://www.instagram.com/p/DfZSA2sDyEt/", { fetchImpl });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("age");
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
