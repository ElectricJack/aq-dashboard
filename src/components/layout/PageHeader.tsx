import { createContext, useContext, type ReactNode } from "react";
import { PageTitle } from "../../app/DestinationPage";
import styles from "./PageHeader.module.css";

/** The shell supplies its supervisor launcher to the page's existing action row. */
export const PageHeaderActionContext = createContext<ReactNode>(null);
export function PageHeader({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const launcher = useContext(PageHeaderActionContext);
  return <div className={styles.header} data-page-header="">
    <div className={styles.identity}><PageTitle>{title}</PageTitle>{children && <div className={styles.meta}>{children}</div>}</div>
    {(actions || launcher) && <div className={styles.actions}>{actions}{launcher}</div>}
  </div>;
}
