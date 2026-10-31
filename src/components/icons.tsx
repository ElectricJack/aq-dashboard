import {
  Ban,
  BookOpen,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CirclePause,
  CirclePlay,
  CircleSlash,
  CircleX,
  Database,
  FileText,
  House,
  List,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  Monitor,
  OctagonAlert,
  RefreshCw,
  Settings,
  TriangleAlert,
  Users,
  Workflow,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { AttentionView, ReadinessView } from "../api/adapters/inspection";
import type { DestinationId } from "../app/destinations";

/**
 * Icons are decorative: every one sits beside text that carries the meaning,
 * so they are hidden from assistive technology (docs/specs/0002 §2, §9).
 */
export function Icon({ icon: Glyph, size = 20, ...rest }: { icon: LucideIcon } & LucideProps) {
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" {...rest} />;
}

export const DESTINATION_ICON: Record<DestinationId, LucideIcon> = {
  overview: House,
  supervisor: Monitor,
  work: Workflow,
  results: List,
  decisions: MessageSquare,
  agents: Users,
  playbooks: BookOpen,
  knowledge: Database,
  settings: Settings,
};

export const READINESS_ICON: Record<ReadinessView["state"], LucideIcon> = {
  draft: CircleDashed,
  ready: CircleDot,
  running: LoaderCircle,
  waiting: CirclePause,
  blocked: Ban,
  needs_decision: TriangleAlert,
  failed: CircleX,
  done: CircleCheck,
  canceled: CircleSlash,
  unsupported: CircleHelp,
};

export const ATTENTION_ICON: Record<AttentionView["kind"], LucideIcon> = {
  decision: FileText,
  blocked: OctagonAlert,
  failed: TriangleAlert,
  uncertain_operation: CircleDashed,
  unsupported: CircleHelp,
};

export const COUNT_ICON = {
  running: CirclePlay,
  ready: ListTodo,
  needs_you: CircleAlert,
  recovering: RefreshCw,
} as const;
