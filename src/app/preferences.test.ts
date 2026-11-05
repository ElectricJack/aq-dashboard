import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, applyPreferences, readPreferences, writePreferences } from "./preferences";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.motion;
});

describe("display preferences", () => {
  it("defaults when nothing or garbage is stored", () => {
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem(PREFERENCES_KEY, "{not json");
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ textSize: "huge", motion: 3, terminalFontSize: 99, body: "secret" }));
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips only the presentation keys", () => {
    writePreferences({ textSize: "larger", motion: "reduce", terminalFontSize: 18 });
    expect(readPreferences()).toEqual({ textSize: "larger", motion: "reduce", terminalFontSize: 18 });
    expect(Object.keys(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!)).sort()).toEqual(["motion", "terminalFontSize", "textSize"]);
  });

  it("applies data attributes on the root element", () => {
    applyPreferences({ textSize: "large", motion: "reduce", terminalFontSize: 16 });
    expect(document.documentElement.dataset.textSize).toBe("large");
    expect(document.documentElement.dataset.motion).toBe("reduce");
    applyPreferences(DEFAULT_PREFERENCES);
    expect(document.documentElement.dataset.textSize).toBeUndefined();
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });
});
