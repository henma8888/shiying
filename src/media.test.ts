import { describe, expect, it } from "vitest";
import { attachmentBlob, packageMedia, saveVideoAsFile } from "./download";
import { extractFromHtml } from "./extract";
import { deliveryMode, describeMedia, type MediaItem } from "./media";

const photo = (url: string): MediaItem => ({ kind: "photo", url });
const video = (url: string): MediaItem => ({ kind: "video", url });

describe("deliveryMode", () => {
  it("saves one file as itself and several files one by one", () => {
    expect(deliveryMode(0)).toBe("none");
    expect(deliveryMode(1)).toBe("single");
    expect(deliveryMode(2)).toBe("each");
    expect(deliveryMode(6)).toBe("each");
  });

  it("describes photo and video counts", () => {
    expect(describeMedia([photo("https://cdn.example/a.jpg")])).toBe("1 張相片");
    expect(describeMedia([video("https://cdn.example/a.mp4")])).toBe("1 條影片");
    expect(
      describeMedia([
        photo("https://cdn.example/a.jpg"),
        photo("https://cdn.example/b.jpg"),
        video("https://cdn.example/c.mp4"),
      ]),
    ).toBe("2 張相片、1 條影片");
  });
});

describe("extractFromHtml", () => {
  it("counts a carousel as separate files and prefers the largest photo", () => {
    const html = `
      <script type="application/json">
        ${JSON.stringify({
          require: [
            {
              code: "ABC123",
              image_versions2: { candidates: [{ url: "https://scontent.cdninstagram.com/cover.jpg", width: 100 }] },
              carousel_media: [
                {
                  image_versions2: {
                    candidates: [
                      { url: "https://scontent.cdninstagram.com/a-small.jpg", width: 200 },
                      { url: "https://scontent.cdninstagram.com/a-big.jpg", width: 1080 },
                    ],
                  },
                },
                {
                  video_versions: [{ url: "https://scontent.cdninstagram.com/b.mp4", width: 720 }],
                  image_versions2: {
                    candidates: [{ url: "https://scontent.cdninstagram.com/b.jpg", width: 720 }],
                  },
                },
              ],
            },
          ],
        })}
      </script>`;
    const extracted = extractFromHtml(html, "ABC123");
    expect(extracted.postFound).toBe(true);
    expect(extracted.items).toEqual([
      { kind: "photo", url: "https://scontent.cdninstagram.com/a-big.jpg", thumb: "https://scontent.cdninstagram.com/a-big.jpg" },
      {
        kind: "video",
        url: "https://scontent.cdninstagram.com/b.mp4",
        thumb: "https://scontent.cdninstagram.com/b.jpg",
      },
    ]);
    expect(deliveryMode(extracted.items.length)).toBe("each");
    expect(describeMedia(extracted.items)).toBe("1 張相片、1 條影片");
  });

  it("reads a multi-escaped Instagram embed sidecar and a reel video", () => {
    const sidecar = JSON.stringify({
      edge_sidecar_to_children: {
        edges: [
          { node: { is_video: false, display_url: "https://scontent.cdninstagram.com/a.jpg" } },
          { node: { is_video: false, display_url: "https://scontent.cdninstagram.com/a.jpg?stp=dst" } },
          { node: { is_video: false, display_url: "https://scontent.cdninstagram.com/b.jpg" } },
        ],
      },
    });
    let wrapped = sidecar;
    for (let layer = 0; layer < 3; layer += 1) {
      wrapped = wrapped.replaceAll('"', '\\"').replaceAll("/", "\\/");
    }
    const photos = extractFromHtml(`<script>${wrapped}</script>`, "IGNORED");
    expect(photos.items.map((item) => item.url)).toEqual([
      "https://scontent.cdninstagram.com/a.jpg",
      "https://scontent.cdninstagram.com/b.jpg",
    ]);
    expect(deliveryMode(photos.items.length)).toBe("each");

    const reel = JSON.stringify({
      is_video: true,
      display_url: "https://scontent.cdninstagram.com/poster.jpg",
      video_url: "https://scontent.cdninstagram.com/clip.mp4",
    });
    const video = extractFromHtml(reel, null);
    expect(video.items).toEqual([
      {
        kind: "video",
        url: "https://scontent.cdninstagram.com/clip.mp4",
        thumb: "https://scontent.cdninstagram.com/poster.jpg",
      },
    ]);
    expect(deliveryMode(video.items.length)).toBe("single");
  });

  it("uses og:image when the post json has no file", () => {
    const html = `<meta property="og:image" content="https://scontent.cdninstagram.com/v/preview.jpg?stp=dst&amp;oe=1" />`;
    const extracted = extractFromHtml(html, "MISSING");
    expect(extracted.items).toEqual([
      {
        kind: "photo",
        url: "https://scontent.cdninstagram.com/v/preview.jpg?stp=dst&oe=1",
        thumb: "https://scontent.cdninstagram.com/v/preview.jpg?stp=dst&oe=1",
      },
    ]);
    expect(deliveryMode(extracted.items.length)).toBe("single");
  });
});

describe("packageMedia", () => {
  function fetchImpl(body: string): typeof fetch {
    return (async (input) => {
      const url = String(input);
      const type = url.endsWith("mp4") ? "video/mp4" : "image/jpeg";
      return new Response(new TextEncoder().encode(body + url), {
        status: 200,
        headers: { "content-type": type },
      });
    }) as typeof fetch;
  }

  it("saves one photo as a single file and a mixed post as separate files", async () => {
    const single = await packageMedia(
      [photo("https://scontent.cdninstagram.com/a.jpg")],
      "shiying_instagram_CODE",
      undefined,
      fetchImpl("img"),
    );
    expect(single.map((file) => file.filename)).toEqual(["shiying_instagram_CODE.jpg"]);
    expect(single[0]?.blob.size).toBeGreaterThan(0);

    const mixed = await packageMedia(
      [photo("https://scontent.cdninstagram.com/a.jpg"), video("https://scontent.cdninstagram.com/b.mp4")],
      "shiying_threads_CODE",
      undefined,
      fetchImpl("file"),
    );
    expect(mixed.map((file) => file.filename)).toEqual([
      "shiying_threads_CODE_01.jpg",
      "shiying_threads_CODE_02.mp4",
    ]);
    expect(deliveryMode(2)).toBe("each");
  });

  it("keeps an iPhone video as a downloadable file", () => {
    const clip = new Blob(["video"], { type: "video/mp4" });
    const photoBlob = new Blob(["photo"], { type: "image/jpeg" });
    expect(saveVideoAsFile("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)")).toBe(true);
    expect(saveVideoAsFile("Mozilla/5.0 (Linux; Android 14)", "Linux armv8l", 5)).toBe(false);
    expect(saveVideoAsFile("Mozilla/5.0 (Macintosh)", "MacIntel", 5)).toBe(true);
    expect(attachmentBlob(clip, true).type).toBe("application/octet-stream");
    expect(attachmentBlob(clip, false).type).toBe("video/mp4");
    expect(attachmentBlob(photoBlob, true).type).toBe("image/jpeg");
  });

  it("refuses a media url outside the public cdn", async () => {
    await expect(
      packageMedia([photo("https://evil.example/a.jpg")], "demo", undefined, fetchImpl("x")),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});
