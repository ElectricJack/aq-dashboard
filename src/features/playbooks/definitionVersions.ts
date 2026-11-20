import { adaptCatalog, mergeCatalogPages, type CatalogPage, type CatalogRequest, type CatalogStamp } from "../../api/adapters/playbookCatalog";
import { playbookCatalogJson } from "../../api/playbookCatalogClient";

/** Resolve version labels against the same namespace and metadata snapshot as the definitions. */
export async function boundArtifacts(project: string | null, definitions: CatalogStamp, signal: AbortSignal) {
  const stamp: CatalogStamp = { ...definitions, kind: "activations" };
  const pages: CatalogPage[] = [];
  let after: string | null = null;
  do {
    const request: CatalogRequest = { stamp, after };
    const raw = await playbookCatalogJson("activations", project, request, signal);
    const page = adaptCatalog(raw, "activations", project, request);
    pages.push(page);
    after = page.next;
  } while (after && pages.length < 4);
  if (after) throw new Error("Binding catalog exceeds the inspection limit");
  return new Set(mergeCatalogPages(pages).map(binding => binding.artifact));
}
