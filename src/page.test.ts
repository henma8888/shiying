import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return new TextDecoder().decode(readFileSync(new URL(path, import.meta.url)));
}

describe("page", () => {
  it("pastes for a preview, and downloads only from an explicit control", () => {
    const html = read("../index.html");
    expect(html).toContain(">貼上<");
    expect(html).toContain(">貼上並下載<");
    expect(html).toContain(">清除<");
    expect(html).toContain('id="download"');
    expect(html).toContain(">下載<");
    expect(html).not.toContain("自動下載");
  });

  it("keeps the preview cells small", () => {
    const css = read("./style.css");
    expect(css).toContain("minmax(5.5rem, 1fr)");
    expect(css).toContain("height: 5.5rem");
  });
});
