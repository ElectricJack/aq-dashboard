import { rejectResponse } from "./responseBytes";
import { ApiError } from "./client";

/** Historical observation endpoints use finite same-origin requests and share the HTTP contract. */
export async function observationBody(path: string, signal: AbortSignal, label: string): Promise<ReadableStream<Uint8Array>> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let response: Response;
  try {
    response = await fetch(path, {
      method: "GET", credentials: "same-origin", mode: "same-origin", redirect: "error",
      cache: "no-store", signal: deadline, headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (deadline.aborted) throw error;
    throw new ApiError("transport", `${label} request could not reach AQ`);
  }
  return checkedBody(response, label);
}

function checkedBody(response: Response, label: string): ReadableStream<Uint8Array> {
  if (!response.ok) {
    rejectResponse(response, new ApiError("http", `AQ responded ${response.status}`, { status: response.status }));
  }
  if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
    rejectResponse(response, new ApiError("contract", `Invalid ${label.toLowerCase()} response`));
  }
  return response.body;
}
