import type { QuotaWindowView } from "../../api/adapters/providerUsage";
import { FreshnessLabel } from "../QueryStatus/FreshnessLabel";
import { formatUntil } from "../time/relative";
import styles from "./ProviderUsageStrip.module.css";

const UNAVAILABLE_TEXT: Record<Exclude<QuotaWindowView["state"], "known">, string> = {
  unknown: "Usage unavailable",
  unavailable: "Usage unavailable",
  unsupported: "Unsupported usage state",
};

/** Display value only; never rounds a nonzero value to 0% or a sub-limit value to 100%. */
export function formatPercent(pct: number): string {
  if (pct > 0 && pct < 1) return "<1%";
  if (pct > 99 && pct < 100) return ">99%";
  return `${Math.round(pct)}%`;
}

/**
 * "full" is the disclosure presentation. "strip" is the one-row header presentation: it adds a
 * labelled progress bar and keeps freshness in its own span so a shared label can replace it.
 */
export function WindowSummary({ win, serverTime, variant = "full", name }: { win: QuotaWindowView; serverTime: string; variant?: "full" | "strip"; name?: string }) {
  return (
    <>
      <WindowFigure win={win} name={name} strip={variant === "strip"} />
      <span className={styles.meta}>
        {win.label}
        {win.coverage === "partial" && <span className={styles.qualifier}> · partial data</span>}
        {win.resetsAt ? <> · resets {formatUntil(serverTime, win.resetsAt)}</> : " · reset unknown"}
        <span className={styles.freshness}>
          {" · "}
          <FreshnessLabel serverTime={serverTime} observedAt={win.observedAt} stale={win.freshness === "stale"} />
        </span>
      </span>
    </>
  );
}

function WindowFigure({ win, name, strip }: { win: QuotaWindowView; name?: string; strip: boolean }) {
  const percent = win.state === "known" ? win.usedPercent : null;
  if (percent === null) return <span className={styles.figure}><span className={styles.unknown}>{UNAVAILABLE_TEXT[win.state as keyof typeof UNAVAILABLE_TEXT]}</span></span>;
  const level = percent >= 80 ? "high" : "normal";
  const used = `${formatPercent(percent)} used`;
  return <span className={styles.figure}>
    <UsageBar {...{ win, name, strip, level, used, percent }} />
    {/* In the strip the progress bar carries the spoken value. */}
    <span className={styles.percent} data-level={level} aria-hidden={strip || undefined}>{used}</span>
    {win.quality === "estimated" && <span className={styles.qualifier}>estimated</span>}
  </span>;
}

function UsageBar({ win, name, strip, level, used, percent }: { win: QuotaWindowView; name?: string; strip: boolean; level: string; used: string; percent: number }) {
  const fill = <span style={{ inlineSize: `${percent}%` }} />;
  if (!strip) return <span className={styles.bar} data-level={level} aria-hidden="true">{fill}</span>;
  return <span
    className={styles.bar}
    data-level={level}
    data-stale={win.freshness === "stale" || undefined}
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(percent)}
    aria-valuetext={used}
    aria-label={`${[name, win.label].filter(Boolean).join(" ")}: ${used}`}
  >{fill}</span>;
}
