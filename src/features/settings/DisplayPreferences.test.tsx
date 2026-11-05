import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PREFERENCES_KEY, readPreferences } from "../../app/preferences";
import { DisplayPreferences } from "./DisplayPreferences";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.textSize;
  delete document.documentElement.dataset.motion;
});

describe("DisplayPreferences", () => {
  it("offers labelled text size, motion and terminal size controls that apply and persist", async () => {
    const user = userEvent.setup();
    render(<DisplayPreferences />);
    expect(screen.getByRole("region", { name: "Display" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Larger" }));
    expect(document.documentElement.dataset.textSize).toBe("larger");
    await user.click(screen.getByRole("checkbox", { name: "Reduce motion" }));
    expect(document.documentElement.dataset.motion).toBe("reduce");
    await user.selectOptions(screen.getByRole("combobox", { name: "Terminal text size" }), "18");
    expect(readPreferences()).toEqual({ textSize: "larger", motion: "reduce", terminalFontSize: 18 });
    expect(localStorage.getItem(PREFERENCES_KEY)).not.toBeNull();
  });

  it("starts from stored preferences", () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ textSize: "large", motion: "system", terminalFontSize: 16 }));
    render(<DisplayPreferences />);
    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Reduce motion" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Terminal text size" })).toHaveValue("16");
  });
});
