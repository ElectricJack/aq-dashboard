import { ActionButton } from "../../../components/layout/Workspace";
import { hostedWorkerCommand, useWorkerInstaller } from "./AddMachine";
import styles from "./WorkerInspector.module.css";

export function useControlsCommand() {
  const installer = useWorkerInstaller();
  return hostedWorkerCommand(installer.origin, installer.digest, true);
}

const instructions = {
  logins: { title: "Update this worker", message: "Run this once in this machine’s WSL terminal. Its existing enrollment is kept.", button: "Copy install command", copied: "Install command copied.", failed: "Copy the install command above." },
  diagnostics: { title: "Enable remote controls", message: "Open this dashboard on the worker’s PC and run the copied command once in WSL. Enrollment and logins are kept.", button: "Copy worker update", copied: "Worker update command copied.", failed: "Copy the command above." },
};

export function WorkerInstallerHelp({ command, mode, setError }: {
  command: string | null; mode: keyof typeof instructions; setError(message: string): void;
}) {
  if (!command) return null;
  const copy = instructions[mode];
  function copyCommand() {
    void navigator.clipboard.writeText(command!).then(() => setError(copy.copied), () => setError(copy.failed));
  }
  return <details className={styles.more}>
    <summary>{copy.title}</summary><p className={styles.note}>{copy.message}</p><code className={styles.command}>{command}</code>
    <ActionButton onClick={copyCommand}>{copy.button}</ActionButton>
  </details>;
}
