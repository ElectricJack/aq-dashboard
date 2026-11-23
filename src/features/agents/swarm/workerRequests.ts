import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ContractError, isRecord } from "../../../api/adapters/contract";
import { apiSend, ApiError, isHttpClientError } from "../../../api/client";

type WorkerOperation = { operation_id: string };
const requestTypes = {
  "worker-logins": { field: "generation", invalid: "Invalid login delivery receipt", declined: "Token delivery could not be requested.", unknown: "Confirmation is pending. Retry to check the same request." },
  "worker-diagnostics": { field: "operation_id", invalid: "Invalid worker check receipt", declined: "Worker check could not be requested.", unknown: "Confirmation is pending. Retry the same request." },
};

export function useWorkerRequest<T extends WorkerOperation>(kind: keyof typeof requestTypes, nodeId: string) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function send(create: () => T) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const operation = pending ?? create();
    setPending(operation);
    const config = requestTypes[kind];
    try {
      const receipt = await apiSend<unknown>("POST", `/api/${kind}/${encodeURIComponent(nodeId)}`, operation);
      if (!isRecord(receipt) || receipt[config.field] !== operation.operation_id) throw new ContractError(config.invalid);
      setPending(null);
      await client.invalidateQueries({ predicate: q => q.queryKey.includes(kind) });
    } catch (e) {
      if (isHttpClientError(e)) setPending(null);
      setError(e instanceof ApiError ? e.serverMessage ?? config.declined : config.unknown);
    } finally { setBusy(false); lock.current = false; }
  }
  return { busy, error, setError, pending, send };
}
