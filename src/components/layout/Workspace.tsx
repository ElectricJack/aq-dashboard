import { useId, type ComponentPropsWithRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import styles from "./Workspace.module.css";

function classes(base: string | undefined, extra?: string) { return [base, extra].filter(Boolean).join(" "); }
/** Shared presentation only. Feature owners retain data, capability and action policy. */
export function Panel({ title, description, actions, children, className, ...props }: Omit<ComponentPropsWithoutRef<"section">, "title"> & {
  title: ReactNode; description?: ReactNode; actions?: ReactNode;
}) {
  const id = useId();
  return <section {...props} aria-labelledby={props["aria-labelledby"] ?? id} className={classes(styles.panel, className)}>
    <div className={styles.heading}><div><h2 id={id}>{title}</h2>{description && <p className={styles.description}>{description}</p>}</div>{actions}</div>
    {children}
  </section>;
}
export function Toolbar({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={classes(styles.toolbar, className)} />;
}
export function ActionButton({ className, type = "button", ...props }: ComponentPropsWithRef<"button">) {
  return <button {...props} type={type} className={classes(styles.control, className)} />;
}
export function DetailList({ className, ...props }: ComponentPropsWithoutRef<"dl">) {
  return <dl {...props} className={classes(styles.facts, className)} />;
}
