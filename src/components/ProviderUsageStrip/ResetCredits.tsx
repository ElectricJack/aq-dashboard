import type { ResetCreditsView } from "../../api/adapters/providerUsage";
import { FreshnessLabel } from "../QueryStatus/FreshnessLabel";
import styles from "./ProviderUsageStrip.module.css";

const RESET_LIMIT_LABELS: Record<string, string> = {
  five_hour: "5-hour limit", seven_day: "weekly limit", seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit", seven_day_oauth_apps: "weekly OAuth apps limit",
};

type GrantView = NonNullable<ResetCreditsView["grants"]>[number];

function grantUsability(grant: GrantView, stale: boolean, serverTime: string) {
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(serverTime)) return " · Expired";
  if (grant.usableNow === false) return stale ? " · Not usable when observed" : " · Not usable now";
  if (grant.usableNow === true) return stale ? " · Usable when observed" : " · Usable now";
  return null;
}

function Grant({ grant, stale, serverTime }: { grant: GrantView; stale: boolean; serverTime: string }) {
  return <li>
    {grant.label}{grant.remainingCount !== null && ` · ${grant.remainingCount} remaining`}
    {grant.expiresAt && <> · expires <time dateTime={grant.expiresAt}>{new Date(grant.expiresAt).toLocaleString()}</time></>}
    {grantUsability(grant, stale, serverTime)}
    {grant.clears.length > 0 && ` · Clears: ${[...new Set(grant.clears.map(key => RESET_LIMIT_LABELS[key] ?? "other limit"))].join(", ")}`}
  </li>;
}

function resetCount(credits: ResetCreditsView | undefined) {
  if (credits?.state === "known") return String(credits.availableCount);
  return credits?.state === "unavailable" ? "Unavailable" : "Unknown";
}

export function Resets({ credits, serverTime }: { credits: ResetCreditsView | undefined; serverTime: string }) {
  const grants = credits?.grants ?? [];
  const stale = credits?.freshness === "stale";
  const observedAt = credits?.observedAt;
  return <div className={styles.resets}>
    <span className={styles.name}>Available resets: {resetCount(credits)}</span>
    {observedAt && <span className={styles.meta}> · <FreshnessLabel serverTime={serverTime} observedAt={observedAt} stale={stale} /></span>}
    {!observedAt && stale && <span className={styles.stale}> · Stale</span>}
    {grants.length > 0 && <ul className={styles.grants}>
      {grants.map((grant, i) => <Grant key={i} grant={grant} stale={stale} serverTime={serverTime} />)}
    </ul>}
  </div>;
}
