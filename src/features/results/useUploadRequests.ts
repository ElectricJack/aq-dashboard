import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { queryKey } from "../../api/queryKeys";
import { ApiError } from "../../api/client";
import { canonicalMedia, type MediaBinding } from "../../api/adapters/resultMedia";
import { adaptUploadStatus, type FrozenUpload, type UploadStatus } from "../../api/adapters/resultMediaUpload";
import { uploadRequest, type UploadAction } from "../../api/resultMediaUploadClient";
import type { UploadActivity } from "./UploadActivity";
import { referenceKey, uploadFinished, uploadSteps, type Snapshot, type Reference } from "./uploadRecovery";

type UploadUpdates = {
  setWorking(value: boolean): void;
  setSelectedName(value: string | null): void;
  setSnapshot(value: Snapshot): void;
};

function uploadFailure(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return "No status is available yet. This upload may still exist; keep its recovery reference.";
  return "Upload outcome is unknown. Check its status before continuing; no replacement was created.";
}

export function useUploadRequests(binding: MediaBinding, activity: UploadActivity, updates: UploadUpdates) {
  const client = useQueryClient(), { queryContext } = useSession(), [scope] = useScope();
  const { setWorking, setSelectedName, setSnapshot } = updates;
  function recordStep(value: UploadStatus, ownerKey: string, intent?: FrozenUpload) {
    activity.baseline = value;
    const ended = uploadFinished(value);
    const frozen = activity.writeAllowed && !ended ? intent ?? null : null;
    setSnapshot({ key: ownerKey, frozen, status: value, error: null });
    if (!ended) return;
    activity.selected = null;
    setSelectedName(null);
    if (value.state === "retained") void client.invalidateQueries({
      predicate: query => query.queryKey[0] === "aq" && query.queryKey[4] === "result-media-list"
        && canonicalMedia((query.queryKey[5] as { binding?: MediaBinding })?.binding) === canonicalMedia(binding),
    });
  }
  function fetchStep(kind: UploadAction, ref: Reference, attempt: ReturnType<UploadActivity["request"]>, intent?: FrozenUpload) {
    return client.fetchQuery({ queryKey: queryKey(queryContext, "result-media-upload", { binding, scope, reference: ref, action: kind, attempt: attempt.ticket }), retry: false, staleTime: 0, gcTime: 0,
        queryFn: async ({ signal }) => adaptUploadStatus(await uploadRequest(kind, ref.operation, AbortSignal.any([attempt.signal, signal]), intent), { binding, actor: queryContext.principalId, operation: ref.operation, requestDigest: ref.requestDigest, frozen: intent, previous: activity.baseline }) });
  }

  async function execute(action: UploadAction, ref: Reference, intent?: FrozenUpload, continueUpload = false) {
    const attempt = activity.request(action);
    const ownerKey = referenceKey(ref);
    setWorking(true);
    const step = async (kind: UploadAction) => {
      if (kind !== "lookup" && !activity.writeAllowed) return undefined;
      const value = await fetchStep(kind, ref, attempt, intent);
      if (!attempt.current()) return undefined;
      recordStep(value, ownerKey, intent);
      return value;
    };
    try {
      await uploadSteps(step, action, { continueUpload, intent });
    } catch (error) {
      if (!attempt.current()) return;
      setSnapshot({ key: ownerKey, frozen: activity.writeAllowed ? intent ?? null : null, status: null, error: uploadFailure(error) });
    } finally {
      if (attempt.finish()) setWorking(false);
    }
  }
  return execute;
}
