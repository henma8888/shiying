import { describe, expect, it } from "vitest";
import { parseInput } from "./url";

describe("parseInput", () => {
  it("strips Instagram tracking params and keeps the reel code", () => {
    const parsed = parseInput(
      "https://www.instagram.com/reel/DeauQaKNJcM/?vrfl=MTB5azlnMGhtMHM2aA==&igsh=MWYyd2llNGx1dXBmcA==&utm_source=ig_web",
    );
    expect(parsed).toEqual({
      ok: true,
      service: "instagram",
      kind: "post",
      canonical: "https://www.instagram.com/reel/DeauQaKNJcM/",
      code: "DeauQaKNJcM",
    });
  });

  it("strips post tracking params such as cplk, fbclid and img_index", () => {
    const parsed = parseInput(
      "look https://instagram.com/p/DfBxDqjSUmb/?cplk=aDVrdTRybDF4eTd5&fbclid=IwAR0&img_index=2",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.canonical).toBe("https://www.instagram.com/p/DfBxDqjSUmb/");
    expect(parsed.canonical.includes("?")).toBe(false);
    expect(parsed.code).toBe("DfBxDqjSUmb");
  });

  it("normalises reels and tv paths", () => {
    expect(parseInput("https://www.instagram.com/reels/AbC123_-z/").ok && parseInput("https://www.instagram.com/reels/AbC123_-z/")).toMatchObject({
      canonical: "https://www.instagram.com/reel/AbC123_-z/",
    });
    expect(parseInput("https://m.instagram.com/tv/AbC123/")).toMatchObject({
      canonical: "https://www.instagram.com/tv/AbC123/",
      kind: "post",
    });
  });

  it("strips Threads tracking params from threads.net and threads.com", () => {
    const net = parseInput("https://www.threads.net/@mosseri/post/DDupwppSjcp?hl=en&x=1");
    expect(net).toMatchObject({
      ok: true,
      service: "threads",
      kind: "post",
      canonical: "https://www.threads.com/@mosseri/post/DDupwppSjcp",
      code: "DDupwppSjcp",
    });

    const short = parseInput("https://www.threads.com/t/DT9HSWGCOBN/embed/?hl=en");
    expect(short).toMatchObject({
      ok: true,
      service: "threads",
      canonical: "https://www.threads.com/t/DT9HSWGCOBN",
      code: "DT9HSWGCOBN",
    });
    if (short.ok) expect(short.canonical.includes("?")).toBe(false);
  });

  it("marks stories and highlights as stories, not posts", () => {
    expect(parseInput("https://www.instagram.com/stories/instagram/12345/?utm_source=ig_web")).toMatchObject({
      ok: true,
      kind: "story",
      code: "12345",
    });
    expect(parseInput("https://www.instagram.com/stories/highlights/180123/")).toMatchObject({
      kind: "story",
    });
  });

  it("keeps Instagram share links instead of rewriting them into a post path", () => {
    expect(parseInput("https://www.instagram.com/share/reel/BAJexample/?igsh=abc")).toMatchObject({
      ok: true,
      service: "instagram",
      kind: "post",
      canonical: "https://www.instagram.com/share/reel/BAJexample/",
      code: null,
    });
    expect(parseInput("https://www.threads.net/@user.name/post/AbC123/?hl=en").ok).toBe(true);
  });

  it("rejects profiles and unrelated urls", () => {
    expect(parseInput("https://www.instagram.com/natgeo/").ok).toBe(false);
    expect(parseInput("https://example.com/p/AbC123").ok).toBe(false);
    expect(parseInput("hello").ok).toBe(false);
  });
});
