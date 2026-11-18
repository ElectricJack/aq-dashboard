import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dagre from "@dagrejs/dagre";
import { useQuery } from "@tanstack/react-query";
import {
  Background, BaseEdge, getViewportForBounds, Handle, MarkerType, Position, ReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import { CircleStop, GitBranch, GitMerge, Hourglass, Maximize, Minus, Play, Plus, Repeat, Terminal, Workflow } from "lucide-react";
import "@xyflow/react/dist/style.css";
import { apiGet } from "../../api/client";
import { adaptDefinitionGraph, DEFINITION_GRAPH_CAPABILITY, type DefinitionGraph, type DefinitionInspection, type GraphStep } from "../../api/adapters/playbookGraph";
import type { Namespace } from "../../api/adapters/playbooks";
import { scopedKey } from "../../api/queryKeys";
import { useScope } from "../../app/scope";
import { useSession } from "../../app/session";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { useMediaQuery } from "../../components/useMediaQuery";
import { humanize } from "./RunTimeline";
import { PlaybookDescription } from "./PlaybookDescription";
import { StepInspector } from "./StepInspector";
import styles from "./WorkflowGraph.module.css";

const kinds = {
  invoke: { label: "Command", icon: Terminal },
  decide: { label: "Decision", icon: GitBranch },
  wait: { label: "Wait", icon: Hourglass },
  for_each: { label: "Loop", icon: Repeat },
  call: { label: "Call playbook", icon: Workflow },
  join: { label: "Join", icon: GitMerge },
  return: { label: "Finish", icon: CircleStop },
};
const height = 76;
const minZoom = 0.08;
const graphLabels = { "node.a11yDescription.default": "Press Enter or Space to inspect this step." };
type StepNode = Node<{ step: GraphStep; isStart: boolean; vertical: boolean }, "step">;
type PathEdge = Edge<{ path: string; labelX: number; labelY: number }, "path">;

function StepCard({ data: { step, isStart, vertical } }: NodeProps<StepNode>) {
  const { label, icon: Icon } = kinds[step.kind];
  return <div className={styles.card} data-kind={step.kind} data-start={isStart}>
    <Handle className={styles.port} type="target" position={vertical ? Position.Top : Position.Left} />
    <span className={styles.kind}><Icon size={14} aria-hidden />{label}{isStart && <span className={styles.start}><Play size={11} aria-hidden />Start</span>}</span>
    <strong title={step.id}>{humanize(step.id)}</strong>
    <Handle className={styles.port} type="source" position={vertical ? Position.Bottom : Position.Right} />
  </div>;
}

function TransitionPath({ id, data, markerEnd, style, label }: EdgeProps<PathEdge>) {
  return data && <BaseEdge id={id} path={data.path} markerEnd={markerEnd} style={style}
    label={label} labelX={data.labelX} labelY={data.labelY} labelBgPadding={[5, 3]} labelBgBorderRadius={4}
    labelStyle={{ fill: "var(--color-text)", stroke: "none", fontSize: 13 }}
    labelBgStyle={{ fill: "var(--color-panel)", stroke: "var(--color-border)" }} />;
}
const nodeTypes = { step: StepCard };
const edgeTypes = { path: TransitionPath };

function layout(graph: DefinitionGraph, start: string, vertical: boolean) {
  const width = vertical ? 164 : 174;
  const order = new Set([start]);
  for (const id of order) {
    for (const transition of graph.steps.get(id)!.transitions) order.add(transition.to);
  }

  const diagram = new dagre.graphlib.Graph({ multigraph: true });
  diagram.setGraph({ rankdir: vertical ? "TB" : "LR", ranksep: vertical ? 48 : 46, nodesep: 28, edgesep: 20 });
  // Graphlib stores node names as object keys. Prefix IDs to keep names such as "__proto__" ordinary.
  const nodePrefix = "step:";
  for (const id of order) diagram.setNode(nodePrefix + id, { width, height });
  for (const id of order) {
    // Several outcomes can reach the same step. Show those together on one path.
    const groups = new Map<string, { to: string; labels: string[]; error: boolean }>();
    for (const { to, label, error } of graph.steps.get(id)!.transitions) {
      const key = JSON.stringify([to, error]);
      const group = groups.get(key) ?? { to, labels: [], error };
      group.labels.push(humanize(label));
      groups.set(key, group);
    }
    let sequence = 0;
    for (const { to, labels, error } of groups.values()) {
      const fullLabel = labels.join(" / ");
      const label = fullLabel.length > 22 ? `${fullLabel.slice(0, 21)}…` : fullLabel;
      diagram.setEdge(nodePrefix + id, nodePrefix + to, {
        label, error, width: label.length * 6 + 12, height: 20, labelpos: "c",
      }, JSON.stringify([id, sequence++]));
    }
  }
  dagre.layout(diagram);

  const nodes: StepNode[] = [...order].map(id => {
    const step = graph.steps.get(id)!;
    const { x, y } = diagram.node(nodePrefix + id);
    const isStart = id === start;
    return {
      id, type: "step", position: { x: x - width / 2, y: y - height / 2 }, width, height,
      ariaRole: "button",
      data: { step, isStart, vertical },
    };
  });
  const edges: PathEdge[] = diagram.edges().map(edge => {
    const route = diagram.edge(edge) as {
      points: { x: number; y: number }[]; x: number; y: number; label: string; error: boolean;
    };
    const color = route.error ? "var(--color-attention)" : "var(--color-text-secondary)";
    const source = edge.v.slice(nodePrefix.length);
    const target = edge.w.slice(nodePrefix.length);
    return {
      id: edge.name!, source, target, type: "path", label: route.label,
      selectable: false,
      ariaLabel: `${humanize(source)} to ${humanize(target)}: ${route.label}`,
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: route.error ? "5 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      data: { path: route.points.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x},${y}`).join(" "), labelX: route.x, labelY: route.y },
    };
  });
  const bounds = diagram.graph();
  return { nodes, edges, reachable: order, bounds: { x: 0, y: 0, width: bounds.width!, height: bounds.height! } };
}

function GraphCanvas({ graph, start, vertical }: { graph: DefinitionGraph; start: string; vertical: boolean }) {
  const [stepId, setStep] = useState<string | null>(null);
  const flow = useRef<ReactFlowInstance<StepNode, PathEdge>>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const canvasSize = useRef({ width: 0, height: 0 });
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const hintId = useId();
  const { nodes, edges, reachable, bounds } = useMemo(() => layout(graph, start, vertical), [graph, start, vertical]);
  const selectedNodes = useMemo(() => nodes.map(node => {
    const selected = node.id === stepId;
    return { ...node, selected, domAttributes: { "aria-pressed": selected } };
  }), [nodes, stepId]);
  const step = stepId === null ? undefined : graph.steps.get(stepId);
  const open = Boolean(step);
  const explained = Boolean(step?.inspection || step?.transitions.some(transition => transition.reason));
  const fit = useCallback(() => {
    if (!canvas.current || !flow.current) return;
    const { clientWidth, clientHeight } = canvas.current;
    if (clientWidth && clientHeight) {
      void flow.current.setViewport(getViewportForBounds(bounds, clientWidth, clientHeight, minZoom, 1, 0.09));
    }
  }, [bounds]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const instance = flow.current;
      if (!instance || !canvas.current) return;
      const { clientWidth, clientHeight } = canvas.current;
      const previous = canvasSize.current;
      if (!clientWidth || (clientWidth === previous.width && clientHeight === previous.height)) return;
      canvasSize.current = { width: clientWidth, height: clientHeight };
      const node = nodes.find(node => node.id === stepId);
      if (node) {
        const zoom = instance.getZoom();
        const bounds = { ...node.position, width: node.width!, height };
        void instance.setViewport(getViewportForBounds(bounds, clientWidth, clientHeight, zoom, zoom, 0));
      } else {
        fit();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [fit, nodes, stepId]);
  useEffect(() => {
    if (stepId && (vertical || focusHeading.current)) heading.current?.focus({ preventScroll: !vertical });
    focusHeading.current = false;
  }, [vertical, stepId]);
  function closeStep() {
    canvas.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(stepId ?? "")}"]`)?.focus();
    setStep(null);
  }
  function goTo(id: string) {
    const node = nodes.find(node => node.id === id);
    if (!node) return;
    if (id === stepId) heading.current?.focus({ preventScroll: !vertical });
    else focusHeading.current = true;
    setStep(id);
    if (flow.current) {
      const zoom = Math.max(0.78, flow.current.getZoom());
      void flow.current.setCenter(node.position.x + node.width! / 2, node.position.y + height / 2, { zoom });
    }
  }
  return <div className={styles.graphContainer}>
    <div className={styles.graphLayout} data-inspecting={open} data-explained={explained}>
      <div className={styles.frame} role="region" aria-label="Workflow diagram" aria-describedby={hintId}>
        <div className={styles.toolbar}>
          <span id={hintId}>Select a step for details</span>
          <div className={styles.controls} role="group" aria-label="Workflow view controls">
            <ActionButton aria-label="Zoom in" title="Zoom in" onClick={() => void flow.current?.zoomIn()}><Plus size={16} aria-hidden /></ActionButton>
            <ActionButton aria-label="Zoom out" title="Zoom out" onClick={() => void flow.current?.zoomOut()}><Minus size={16} aria-hidden /></ActionButton>
            <ActionButton aria-label="Fit view" title="Fit view" onClick={fit}><Maximize size={16} aria-hidden /></ActionButton>
          </div>
        </div>
        <div ref={canvas} className={styles.canvas}>
          <ReactFlow<StepNode, PathEdge> nodes={selectedNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            colorMode="dark" minZoom={minZoom} maxZoom={2}
            nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} zoomOnScroll={false}
            deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
            elevateNodesOnSelect={false} proOptions={{ hideAttribution: true }} ariaLabelConfig={graphLabels}
            onInit={instance => {
              flow.current = instance;
              if (canvas.current) canvasSize.current = { width: canvas.current.clientWidth, height: canvas.current.clientHeight };
              fit();
            }}
            onNodeClick={(_, node) => setStep(node.id)}
            onNodesChange={changes => {
              const selection = changes.find(change => change.type === "select" && change.selected);
              if (selection?.type === "select") setStep(selection.id);
            }}>
            <Background color="var(--color-border)" gap={17} size={1} />
          </ReactFlow>
        </div>
      </div>
      {step && <StepInspector step={step} kind={kinds[step.kind].label} reachable={reachable} headingRef={heading} onClose={closeStep} onNavigate={goTo} />}
    </div>
  </div>;
}

function GraphWorkspace({ graph, initialEntry }: { graph: DefinitionGraph; initialEntry?: string }) {
  const [choice, setChoice] = useState(initialEntry);
  const entry = choice && graph.entries.has(choice) ? choice : graph.entries.keys().next().value!;
  const start = graph.entries.get(entry)!;
  const vertical = useMediaQuery("(max-width: 760px)");
  return <Panel title="Compiled workflow" className={styles.panel}
    actions={graph.entries.size === 1 ? <div className={styles.entry}>Entry point <strong>{humanize(entry)}</strong></div> :
      <label className={styles.entry}>Entry point
        <select value={entry} onChange={event => setChoice(event.target.value)}>
          {[...graph.entries.keys()].map(key => <option value={key} key={key}>{humanize(key)}</option>)}
        </select>
      </label>}>
    <GraphCanvas key={JSON.stringify([entry, vertical])} graph={graph} start={start} vertical={vertical} />
  </Panel>;
}

export function WorkflowGraph({ artifact, namespace, entry, showDescription = false }: {
  artifact: string; namespace: Namespace; entry?: string; showDescription?: boolean;
}) {
  const [scope] = useScope();
  const { bootstrap, queryContext } = useSession();
  const capability = bootstrap.capability(DEFINITION_GRAPH_CAPABILITY);
  const query = useQuery<DefinitionInspection>({
    enabled: capability.enabled,
    queryKey: scopedKey(queryContext, scope, "playbook-definition-graph", { artifact, namespace }),
    staleTime: query => query.state.data?.graph ? 60_000 : 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ project_id: namespace.projectId });
      const raw = await apiGet<unknown>(`/api/playbooks/inspection/definitions/${encodeURIComponent(artifact)}/graph?${params}`, signal);
      return adaptDefinitionGraph(raw, artifact, namespace);
    },
  });
  const inspection = capability.enabled && !query.isError ? query.data : undefined;
  return <>
    {inspection?.graph ? <GraphWorkspace key={artifact} graph={inspection.graph} initialEntry={entry} /> : <Panel title="Compiled workflow">
    {!capability.enabled ? <p>Compiled graphs are unavailable on this AQ server.</p>
      : query.isError || query.isPending ?
        <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="the compiled workflow" onRetry={() => void query.refetch()} />
        : <p>No compiled graph was recorded for this version.</p>}
    </Panel>}
    {showDescription && inspection?.descriptionMarkdown && <PlaybookDescription markdown={inspection.descriptionMarkdown} />}
  </>;
}
