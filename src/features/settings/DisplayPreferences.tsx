import { useId } from "react";
import { TERMINAL_FONT_SIZES, TEXT_SIZES, usePreferences, type TextSize } from "../../app/preferences";
import { Panel } from "../../components/layout/Workspace";
import styles from "./Settings.module.css";

const TEXT_SIZE_LABELS: Record<TextSize, string> = { default: "Default", large: "Large", larger: "Larger" };

export function DisplayPreferences() {
  const [preferences, update] = usePreferences();
  const id = useId();
  return (
    <Panel title="Display" description="Saved in this browser only. These settings hold no content and stay after you sign out.">
      <fieldset className={styles.fieldset}>
        <legend>Text size</legend>
        <div className={styles.choices}>
          {TEXT_SIZES.map((size) => (
            <label key={size} className={styles.choice}>
              <input type="radio" name={`${id}-text`} value={size} checked={preferences.textSize === size} onChange={() => update({ textSize: size })} />
              {TEXT_SIZE_LABELS[size]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={styles.choice}>
        <input type="checkbox" checked={preferences.motion === "reduce"} onChange={(event) => update({ motion: event.target.checked ? "reduce" : "system" })} aria-describedby={`${id}-motion`} />
        Reduce motion
      </label>
      <p id={`${id}-motion`} className={styles.meta}>Off follows your system setting.</p>
      <label className={styles.field}>
        <span>Terminal text size</span>
        <select value={String(preferences.terminalFontSize)} onChange={(event) => update({ terminalFontSize: Number(event.target.value) })}>
          {TERMINAL_FONT_SIZES.map((size) => <option key={size} value={size}>{size} px</option>)}
        </select>
      </label>
    </Panel>
  );
}
