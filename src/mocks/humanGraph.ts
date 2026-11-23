import { graphState, type GraphReads, type GraphSize } from "./humanGraphState";
import { graphActionHandlers } from "./humanGraphActions";
import { graphReadHandlers, graphDetailHandlers } from "./humanGraphReads";
export {
  fixtureProject,
  fixtureTasks,
  fixtureEdges,
  FIXTURE_IDS,
  FIXTURE_ATTEMPTS,
  FIXTURE_ATTEMPT_SESSIONS,
  FIXTURE_RAN_WITH,
} from "./humanGraphData";
export function humanGraphHandlers(reads: GraphReads, graph: GraphSize = "standard") {
  const state = graphState(graph);
  return [
    ...graphReadHandlers(reads, state),
    ...graphActionHandlers(state),
    ...graphDetailHandlers(reads, state),
  ];
}
