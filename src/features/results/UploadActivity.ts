import type { FrozenUpload, UploadStatus } from "../../api/adapters/resultMediaUpload";
import type { UploadAction } from "../../api/resultMediaUploadClient";

/** Ownership of one upload reference, including preparation before the URL is committed. */
export class UploadActivity {
  active = false;
  busy = false;
  writeAllowed = false;
  preparing = false;
  generation = 0;
  selected: File | null = null;
  pendingAdmission: FrozenUpload | null = null;
  reference: string | null = null;
  baseline?: UploadStatus;
  private writeOwner: AbortController | null = null;
  private jobs = new Set<AbortController>();

  current(ticket: number) {
    return this.active && ticket === this.generation;
  }

  currentWrite(ticket: number) {
    return this.current(ticket) && this.writeAllowed;
  }

  clearReference() {
    this.generation++;
    for (const job of this.jobs) job.abort();
    this.pendingAdmission = null;
    this.preparing = false;
    this.selected = null;
    this.baseline = undefined;
  }

  revokeWrite() {
    this.selected = null;
    const pending = this.pendingAdmission || this.writeOwner;
    if (!this.preparing && !pending) return false;
    this.writeOwner?.abort();
    this.writeOwner = null;
    this.pendingAdmission = null;
    this.preparing = false;
    this.generation++;
    this.busy = false;
    return true;
  }

  permits(action: UploadAction) {
    return !this.busy && (action === "lookup" || this.writeAllowed);
  }

  canChoose() {
    return this.writeAllowed && !this.busy;
  }

  prepare() {
    this.preparing = true;
    this.busy = true;
    return ++this.generation;
  }

  finishPreparation(ticket: number) {
    if (!this.current(ticket)) return false;
    this.preparing = false;
    this.busy = false;
    return true;
  }

  request(action: UploadAction) {
    const ticket = ++this.generation;
    const owner = new AbortController();
    this.jobs.add(owner);
    if (action !== "lookup") this.writeOwner = owner;
    this.busy = true;
    const current = () => this.current(ticket) && !owner.signal.aborted;
    return {
      ticket, current, signal: owner.signal,
      finish: () => {
        this.jobs.delete(owner);
        if (this.writeOwner === owner) this.writeOwner = null;
        if (!current()) return false;
        this.busy = false;
        return true;
      },
    };
  }
}
