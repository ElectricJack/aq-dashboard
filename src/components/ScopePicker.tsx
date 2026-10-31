import type { Scope } from "../api/wire/proposed";
import { parseScope, scopeParam } from "../app/scope";

type Props = {
  scope: Scope;
  onChange(scope: Scope): void;
  /** Authorized projects; empty until a projects read model is published (D01). */
  projects: readonly { id: string; label: string }[];
  className?: string;
};

export function ScopePicker({ scope, onChange, projects, className }: Props) {
  const current = scopeParam(scope) ?? "all";
  const options = [...projects];
  if (scope.kind === "project" && !options.some((p) => p.id === scope.project_id)) {
    options.push({ id: scope.project_id, label: scope.project_id });
  }
  return (
    <label className={className}>
      <span className="visually-hidden">Scope</span>
      <select value={current} onChange={(e) => onChange(parseScope(e.target.value))}>
        <option value="all">All projects</option>
        {options.map((p) => (
          <option key={p.id} value={`project:${p.id}`}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
