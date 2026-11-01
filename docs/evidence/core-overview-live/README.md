# Actual core Overview and reference review

The final `6bcfad2` candidate passed `scripts/probe-core-overview.mjs` against the actual API-13 server and production bundle at `localhost:4196` in **819 ms**. Public bootstrap identified the served manifest digest retained in [result.json](result.json). No browser requests were intercepted and no domain mutations occurred.

Actual Graph observations contained one draft and two active records in the default visible task collection. The probe verified that contribution, the exact scoped task link and working detail navigation, desktop primary/secondary columns, and a 390px phone layout without horizontal overflow. No page errors occurred. These are recorded lifecycle observations, not running/ready/capacity or provider quota measurements.

Visual review used `docs/design/01-overview-v3.png` and product specification0002. The final desktop groups Needs your attention above Work in motion and Recent outcomes; the secondary column contains Capacity, Provider status and Sessions. Project observations are compact, extra scope/details are disclosed on demand, and the phone stacks the same hierarchy with actual task content visible in the first viewport. The duplicated project pane and excessive caveat density found during review were corrected before this final run.

Delivered subset: the status band and core panel hierarchy, actual bounded project/task observations, heartbeat/session context and working links. Occupied-slot gauge, provider measurements, pinned-session persistence, Create task, full review/result aggregation and runtime controls remain later work. Unknown source values stay explicitly unavailable; the reference's sample measurements were never copied into runtime data.

Reviewed images: `/tmp/aq-core-overview-browser-final/overview-desktop.png`, `overview-mobile.png`, and `overview-mobile-viewport.png`. Raw log: `/tmp/aq-core-overview-browser-final.log`. The full-page mobile capture places fixed navigation at its viewport boundary; the viewport-only capture records the actual first phone screen.
