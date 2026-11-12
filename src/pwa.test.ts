import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldShowInstall } from "./install";

function read(path: string): Uint8Array {
  return readFileSync(new URL(path, import.meta.url));
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = Array.from(bytes.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
  expect(signature).toBe("89504e470d0a1a0a");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

type Manifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

function loadManifest(): Manifest {
  return JSON.parse(new TextDecoder().decode(read("../public/manifest.webmanifest"))) as Manifest;
}

describe("web app manifest", () => {
  it("is scoped to the GitHub Pages /shiying/ path and opens standalone", () => {
    const app = loadManifest();
    expect(app.id).toBe("/shiying/");
    expect(app.name).toBe("拾影");
    expect(app.short_name).toBe("拾影");
    expect(app.start_url).toBe("/shiying/");
    expect(app.scope).toBe("/shiying/");
    expect(app.start_url.startsWith(app.scope)).toBe(true);
    expect(app.display).toBe("standalone");
  });

  it("ships 192 and 512 purpose-any PNG icons, plus a maskable icon", () => {
    const app = loadManifest();
    const any = app.icons.filter((icon) => icon.purpose === "any");
    expect(any.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of app.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("/shiying/icons/")).toBe(true);
      const file = icon.src.replace("/shiying/", "../public/");
      const size = Number(icon.sizes.split("x")[0]);
      expect(pngSize(read(file))).toEqual({ width: size, height: size });
    }
    expect(app.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });
});

describe("shouldShowInstall", () => {
  it("shows the install control only when the browser offers a prompt and the app is not already installed", () => {
    expect(shouldShowInstall(true, false)).toBe(true);
    expect(shouldShowInstall(false, false)).toBe(false);
    expect(shouldShowInstall(true, true)).toBe(false);
  });
});
