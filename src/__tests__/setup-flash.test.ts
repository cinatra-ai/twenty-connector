// Unit tests for the twenty-connector codes-only flash map (twenty-connector#51).
//
// setup-flash.ts imports only a TYPE from @cinatra-ai/sdk-ui/search-param-toast
// (erased at build time), so this module has no runtime dependency on the host
// package and can be imported directly here.

import { describe, it, expect } from "vitest";
import { TWENTY_SETUP_FLASH_TOASTS } from "../setup-flash";

function entryFor(param: string) {
  return TWENTY_SETUP_FLASH_TOASTS.filter((e) => e.param === param);
}

describe("TWENTY_SETUP_FLASH_TOASTS", () => {
  it("has exactly one entry per legacy banner site: saved, deleted, error", () => {
    const params = TWENTY_SETUP_FLASH_TOASTS.map((e) => e.param);
    expect(new Set(params)).toEqual(new Set(["saved", "deleted", "error"]));
  });

  it("saved=1 maps to a static success toast matching the retired banner copy", () => {
    const [entry] = entryFor("saved");
    expect(entry.value).toBe("1");
    expect(entry.variant).toBe("success");
    expect(entry.message).toBe("Twenty workspace connected.");
  });

  it("deleted=1 maps to a static warning toast matching the retired banner copy", () => {
    const [entry] = entryFor("deleted");
    expect(entry.value).toBe("1");
    expect(entry.variant).toBe("warning");
    expect(entry.message).toBe("Twenty workspace disconnected.");
  });

  it("error has NO bound value (fires on any non-empty ?error=) and never reflects the query text", () => {
    const [entry] = entryFor("error");
    expect(entry.value).toBeUndefined();
    expect(entry.variant).toBe("error");
    expect(typeof entry.message).toBe("string");
    expect(entry.message.length).toBeGreaterThan(0);
    // The static message must never be built from a param — this map is a
    // plain literal array, so there is no way for a raw param value to reach
    // `message`; this test locks that the message is a fixed string, not
    // derived at read time.
    expect(entry.message).toBe(
      "Unable to save the Twenty connection. Check the instance URL and API key, then try again.",
    );
  });

  it("every entry carries a non-empty static message (never undefined/empty, which would toast nothing useful)", () => {
    for (const entry of TWENTY_SETUP_FLASH_TOASTS) {
      expect(entry.message).toBeTruthy();
    }
  });
});
