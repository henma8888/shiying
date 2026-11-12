import { describe, expect, it } from "vitest";
import { errorMessage } from "./copy";
import { classify, signalsFromHtml } from "./errors";
import { parseInput } from "./url";

describe("classify", () => {
  it("turns stories into an unsupported-story error, not a generic failure", () => {
    const parsed = parseInput("https://www.instagram.com/stories/instagram/999/");
    expect(parsed.ok && parsed.kind).toBe("story");
    expect(classify({ parsed: "story" })).toBe("unsupported");
    expect(errorMessage.unsupported).toContain("限時動態");
  });

  it("classifies invalid urls, rate limits, private accounts, age gates and deleted posts separately", () => {
    expect(classify({ parsed: "invalid" })).toBe("invalid");
    expect(classify({ cobaltCode: "error.api.link.invalid" })).toBe("invalid");
    expect(classify({ cobaltCode: "error.api.link.unsupported" })).toBe("unsupported");
    expect(classify({ httpStatus: 429 })).toBe("rate");
    expect(classify({ cobaltCode: "error.api.auth.jwt.missing" })).toBe("rate");
    expect(classify({ cobaltCode: "error.api.rate_exceeded" })).toBe("rate");
    expect(classify({ privateAccount: true })).toBe("private");
    expect(classify({ restrictedAge: 21, cobaltCode: "error.api.fetch.empty" })).toBe("age");
    expect(classify({ failureReason: "MA" })).toBe("age");
    expect(classify({ unavailable: true })).toBe("deleted");
    expect(classify({ network: true })).toBe("network");
    expect(classify({ postFound: true })).toBe("empty");
    expect(classify({ cobaltCode: "error.api.fetch.empty" })).toBe("unavailable");
    expect(classify({ remux: true })).toBe("remux");
  });

  it("reads age and deleted signals from page html", () => {
    const age = signalsFromHtml(`{"failure_reason":"MA","restricted_age":21,"page_type":"MEDIA"}`);
    expect(age.restrictedAge).toBe(21);
    expect(classify(age)).toBe("age");
    expect(errorMessage.age).toContain("21");

    const missing = signalsFromHtml("Sorry, this page isn't available.");
    expect(classify(missing)).toBe("deleted");

    const loginShell = signalsFromHtml(`{"failure_reason":null,"restricted_age":null}`);
    expect(classify({ ...loginShell, cobaltCode: "error.api.fetch.empty" })).toBe("unavailable");
    expect(errorMessage.unavailable).not.toContain("暫時無回應");
  });

  it("does not treat a null restricted_age as an age gate", () => {
    const html = `"restricted_age":null,"failure_reason":null`;
    expect(signalsFromHtml(html).restrictedAge).toBeNull();
    expect(classify(signalsFromHtml(html))).toBe("unavailable");
  });
});
