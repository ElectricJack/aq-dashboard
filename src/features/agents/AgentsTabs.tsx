import { NavLink, useLocation } from "react-router";
import styles from "./AgentsTabs.module.css";

export function AgentsTabs({ current }: { current: "terminals" | "swarm" | "history" | "sessions" }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const scope = params.get("scope");
  const query = scope ? `?${new URLSearchParams({ scope })}` : "";
  const item = (id: "terminals" | "swarm" | "history", to: string, label: string) => (
    <NavLink to={{ pathname: to, search: query }} end aria-current={current === id ? "page" : undefined} className={styles.tab} data-current={current === id || undefined}>{label}</NavLink>
  );
  return <nav className={styles.tabs} aria-label="Agents views">{item("terminals", "/agents", "Terminals")}{item("swarm", "/agents/swarm", "Swarm")}{item("history", "/agents/history", "History")}</nav>;
}
