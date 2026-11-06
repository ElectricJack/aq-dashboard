import { useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

/** The browser's own network state; true where it is unknown. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, online, () => true);
}
