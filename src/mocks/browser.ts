import { network } from "virtual:msw";
import { handlersFor } from "./handlers";

/** Starts the mock network in `vite --mode mock`. `?scenario=` picks a fixture scenario;
 * the labelled terminal and Results fixtures are always on here. */
export async function startMocks() {
  const name = new URLSearchParams(window.location.search).get("scenario");
  network.configure({ handlers: handlersFor(name, { fixtures: true }) });
  await network.enable();
}
