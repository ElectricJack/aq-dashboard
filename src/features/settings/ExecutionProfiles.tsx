import { DetailList } from "../../components/layout/Workspace";
import { EXECUTION_LIMIT_KEYS, type ExecutionLimits } from "../../api/roleSettings";
import { ProfileDocuments, type DocumentsConfig } from "./ProfileDocuments";
import { newDocument } from "./profileMarkdown";

const CONFINEMENT: Record<string, string> = {
  container: "Always in a container", "container-permitted": "A container is permitted, not required",
  native: "Native only; a container is denied", "native-required": "Native confinement is required",
};
const LIMIT_LABELS: Record<keyof ExecutionLimits, string> = {
  wall_time_ms: "Wall time", memory_bytes: "Memory", cpu_millis: "CPU", process_limit: "Processes", startup_context_bytes: "Startup text", max_output_tokens: "Output",
};
function limit(key: keyof ExecutionLimits, value: number): string {
  const exact = value.toLocaleString();
  switch (key) {
    case "wall_time_ms": return `${exact} ms (${(value / 60_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} min)`;
    case "memory_bytes": return `${exact} bytes (${(value / 2 ** 30).toLocaleString(undefined, { maximumFractionDigits: 2 })} GiB)`;
    case "cpu_millis": return `${exact} millicores (${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} CPU)`;
    case "process_limit": return exact;
    case "startup_context_bytes": return `${exact} bytes`;
    case "max_output_tokens": return `${exact} tokens`;
  }
}
const CONFIG: DocumentsConfig<"execution"> = {
  kind: "execution", title: "Execution profiles", level: 2, noun: "execution profile", order: 40,
  description: "An execution profile is where and how a harness runs: the harnesses it may use, the sandbox environment, confinement, a credential profile for each harness and the limits of one attempt. A role names the profile it runs under.",
  columns: [
    { header: "Description", cell: profile => profile.description || "—" },
    { header: "Harnesses", cell: profile => profile.harnesses.join(", ") },
    { header: "Environment", cell: profile => profile.environment },
    { header: "Confinement", cell: profile => profile.confinement },
  ],
  summary: profile => <DetailList>
    <dt>Name</dt><dd>{profile.name}</dd>
    <dt>Id</dt><dd>{profile.id}</dd>
    <dt>Description</dt><dd>{profile.description || "None"}</dd>
    <dt>Harnesses</dt><dd>{profile.harnesses.join(", ")}</dd>
    <dt>Environment</dt><dd>{profile.environment}</dd>
    <dt>Confinement</dt><dd>{profile.confinement}{CONFINEMENT[profile.confinement] && ` (${CONFINEMENT[profile.confinement]!.toLowerCase()})`}</dd>
    <dt>Credentials</dt><dd>{Object.keys(profile.credentials).length ? <ul>{Object.entries(profile.credentials).map(([harness, credential]) => <li key={harness}>{harness}: {credential}</li>)}</ul> : "None"}</dd>
    {EXECUTION_LIMIT_KEYS.map(key => [<dt key={`${key}-label`}>{LIMIT_LABELS[key]}</dt>, <dd key={key}>{limit(key, profile.limits[key])}</dd>])}
  </DetailList>,
  template: () => newDocument("execution"),
};

export function ExecutionProfiles() { return <ProfileDocuments config={CONFIG} />; }
