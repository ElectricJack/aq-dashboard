/** jsdom has no layout engine: React Flow needs a matrix class and non-zero element sizes to draw nodes. */
export function stubReactFlowDom(): () => void {
  const restore: (() => void)[] = [];
  const g = globalThis as unknown as { DOMMatrixReadOnly?: unknown };
  if (!g.DOMMatrixReadOnly) {
    g.DOMMatrixReadOnly = class { m22 = 1; constructor(transform?: string) { const m = /scale\(([\d.]+)\)/.exec(transform ?? ""); if (m) this.m22 = Number(m[1]); } };
    restore.push(() => { delete g.DOMMatrixReadOnly; });
  }
  for (const prop of ["offsetWidth", "offsetHeight"] as const) {
    // jsdom always reports 0 for layout sizes, so the prototype getter is replaced for the test run.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 100 });
    restore.push(() => { if (original) Object.defineProperty(HTMLElement.prototype, prop, original); });
  }
  return () => restore.forEach(fn => fn());
}
