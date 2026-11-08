import { NavLink, useLocation } from "react-router";
import styles from "./AgentsTabs.module.css";

/** Swarm (the landing) and Sessions (the roster) share one row; the scope in the query string is kept across both. */
export function AgentsTabs({ current }: { current: "swarm" | "sessions" }) {
  const { search } = useLocation();
  const scopeOnly = new URLSearchParams(search);
  scopeOnly.delete("select");
  const query = scopeOnly.size ? `?${scopeOnly}` : "";
  const item = (id: "swarm" | "sessions", to: string, label: string) => (
    <NavLink to={{ pathname: to, search: query }} end aria-current={current === id ? "page" : undefined} className={styles.tab} data-current={current === id || undefined}>{label}</NavLink>
  );
  return (
    <nav className={styles.tabs} aria-label="Agents views">
      {item("swarm", "/agents", "Swarm")}
      {item("sessions", "/agents/sessions", "Sessions")}
    </nav>
  );
}
