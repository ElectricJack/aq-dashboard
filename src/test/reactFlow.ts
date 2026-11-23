class LayoutMatrix {
  m22: number;
  constructor(transform?: string) {
    const scale = /scale\(([\d.]+)\)/.exec(transform ?? "");
    this.m22 = scale ? Number(scale[1]) : 1;
  }
}

/** jsdom has no layout engine: React Flow needs a matrix class and non-zero element sizes to draw nodes. */
export function stubReactFlowDom(): () => void {
  const restore: (() => void)[] = [];
  const g = globalThis as unknown as { DOMMatrixReadOnly?: unknown };
  if (!g.DOMMatrixReadOnly) {
    g.DOMMatrixReadOnly = LayoutMatrix;
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
