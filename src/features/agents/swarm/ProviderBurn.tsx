import { useEffect, useState } from "react";
import { useProviderUsage } from "../../../app/useProviderUsage";
import { useSession } from "../../../app/session";
import type { QuotaWindowView } from "../../../api/adapters/providerUsage";
import { appendBurnSample, estimateBurn, type BurnSample } from "./providerBurn";

type Props = { provider: string; proposedLimit: number | null; active: number | null };
const canonical = (provider: string) => provider === "codex" ? "openai" : provider === "claude" ? "anthropic" : provider;
const rate = (value: number) => value === 0 ? "0" : value < 0.1 ? "<0.1" : value.toFixed(1);
function duration(hours: number) { return hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : `${hours.toFixed(1)}h`; }

export function ProviderBurn(props: Props) {
  const { queryContext } = useSession();
  return <SessionBurn key={`${queryContext.principalId}:${queryContext.authorizationRevision}:${props.provider}`} {...props} />;
}

function SessionBurn({ provider, proposedLimit, active }: Props) {
  const usage = useProviderUsage();
  const accounts = usage.state.status === "ready" ? usage.state.data.providers.filter(account => canonical(account.providerId) === canonical(provider)) : [];
  // Different account percentages have different denominators; never average them.
  const account = accounts.length === 1 ? accounts[0] : undefined;
  const window = account?.windows.find(item => item.id === account.preferredWindowId) ?? account?.windows[0];
  return <WindowBurn key={`${account?.accountRef}:${window?.id}`} window={window} active={active} proposedLimit={proposedLimit} multiple={accounts.length > 1} />;
}

function WindowBurn({ window, active, proposedLimit, multiple }: { window?: QuotaWindowView; active: number | null; proposedLimit: number | null; multiple: boolean }) {
  const [samples, setSamples] = useState<BurnSample[]>([]);
  const valid = window?.state === "known" && window.freshness === "fresh" && window.quality === "reported" && window.coverage === "complete";
  useEffect(() => {
    if (!valid || !window || window.usedPercent === null) { setSamples([]); return; }
    const sample = { at: Date.parse(window.observedAt), used: window.usedPercent, reset: window.resetsAt, active };
    setSamples(previous => appendBurnSample(previous, sample));
  }, [valid, window?.observedAt, window?.usedPercent, window?.resetsAt, active]);
  const estimate = valid ? estimateBurn(samples, proposedLimit) : null;
  if (multiple) return <span>Burn estimate unavailable across accounts</span>;
  if (!valid) return <span>Burn estimate unavailable</span>;
  if (!estimate) return <span title="Requires at least five minutes of fresh observations and a measured quota increase in this session.">Collecting usage history…</span>;
  return <span title={`Measured over ${Math.round(estimate.elapsedMinutes)} minutes. Account-wide activity includes other clients. At-cap estimates assume consumption scales linearly with agents; workload and model mix may change. ETA assumes the observed rate continues and ignores future resets.`}>
    {window!.label}: ~{rate(estimate.pointsPerHour)} quota points/h
    {estimate.hoursToLimit !== null && ` · ${estimate.hoursToLimit === 0 ? "limit reached" : `~${duration(estimate.hoursToLimit)} to limit at recent rate`}`}
    {estimate.projectedPointsPerHour !== null && ` · ~${rate(estimate.projectedPointsPerHour)} points/h at ${proposedLimit} active (estimate)`}
  </span>;
}
