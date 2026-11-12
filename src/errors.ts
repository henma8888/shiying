import type { ErrorKind } from "./copy";

export type ClassifyInput = {
  parsed?: "invalid" | "story" | "post";
  httpStatus?: number;
  cobaltCode?: string | null;
  restrictedAge?: number | null;
  failureReason?: string | null;
  privateAccount?: boolean;
  unavailable?: boolean;
  postFound?: boolean;
  network?: boolean;
  remux?: boolean;
};

export function signalsFromHtml(html: string): Pick<
  ClassifyInput,
  "restrictedAge" | "failureReason" | "privateAccount" | "unavailable"
> {
  const ageMatch = html.match(/"restricted_age":\s*(\d+)/);
  const failureMatch = html.match(/"failure_reason":"([^"]+)"/);
  return {
    restrictedAge: ageMatch?.[1] ? Number(ageMatch[1]) : null,
    failureReason: failureMatch?.[1] ?? null,
    privateAccount: /this account is private/i.test(html),
    unavailable: /isn['’]t available/i.test(html) || /sorry,\s*this page/i.test(html),
  };
}

export function classify(input: ClassifyInput): ErrorKind {
  const code = input.cobaltCode ?? "";

  if (input.parsed === "invalid") return "invalid";
  if (input.parsed === "story") return "unsupported";
  if (input.network) return "network";
  if (input.remux) return "remux";
  if (input.httpStatus === 429 || input.httpStatus === 401 || input.httpStatus === 403) {
    return "rate";
  }
  if (/rate[_-]?exceed|too many/i.test(code)) return "rate";
  if (/unsupported/i.test(code)) return "unsupported";
  if (
    (input.restrictedAge != null && input.restrictedAge >= 18) ||
    input.failureReason === "MA" ||
    /\.age\b|age_restricted|age_gate/i.test(code)
  ) {
    return "age";
  }
  if (input.privateAccount || /private/i.test(code)) return "private";
  if (input.unavailable || /unavailable|not_found|deleted/i.test(code)) return "deleted";
  if (/invalid/i.test(code)) return "invalid";
  if (/auth|jwt|require_login|login/i.test(code)) return "rate";
  if (input.postFound) return "empty";
  return "unavailable";
}
