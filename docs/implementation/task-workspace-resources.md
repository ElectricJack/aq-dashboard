# Task workspace resources

With a project selected, open a task’s **Workspace resources** section to request a sibling source or a disposable PostgreSQL service. To decide a source request, select the target project, open its Work list, and expand **Incoming workspace requests**. Each decision uses the displayed project revision, commit and access type. A denied request remains in the target project’s review list, where its owner can reconsider and approve the same pin. A conflict refreshes the request for review.

The Create task dialog can declare resources on the initial task request. The composer creates a draft when it includes a resource declaration. The capability `tasks.workspace.resources` enables these surfaces.

Owner CLI discovery offers `task.workspace.show`, `task.workspace.request`, `project.workspace.requests`, and `project.workspace.decide` through `aq run`.

The Work list and inspector keep the composition in the [approved Work reference](../design/02-work-explorer-v3.png) and [product design](../specs/0002-product-design.md). The visual increment covers the task section, target-project disclosure and create dialog. Browser tests use labelled mock facts, check desktop and phone widths, and save individual captures. Run `pnpm test:e2e tests/workspace-resources.spec.ts --workers=1` to reproduce them. The lane author reviewed the captured layout. The integrated server and deployed bundle remain separate qualification checks.
