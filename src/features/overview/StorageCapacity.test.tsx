import { render, screen, within } from "@testing-library/react";
import { unreportedStorage, type NodeStorage } from "../../api/adapters/nodeStorage";
import { StorageCapacity } from "./StorageCapacity";

const GiB = 1024 ** 3;
function disk(usedPercent: number): NodeStorage {
  const total = 100 * GiB;
  const used = usedPercent * GiB;
  return { total_bytes: total, used_bytes: used, free_bytes: total - used, reserved_bytes: 32 * GiB, preserved_count: 1, preserved_bytes: 4 * GiB };
}
function row(name: string) {
  return screen.getByText(name, { selector: "strong" }).closest("li")!;
}

test("absent storage fields render Not reported without inventing percentages", () => {
  render(<StorageCapacity central={unreportedStorage} nodes={[{ id: "n1", name: "Desktop", storage: unreportedStorage }, { id: "n2", name: "Partial", storage: { ...unreportedStorage, used_bytes: 10 * GiB } }]} />);
  expect(within(row("Central")).getByText("Not reported")).toBeVisible();
  expect(within(row("Desktop")).getByText("Not reported")).toBeVisible();
  const partial = row("Partial");
  expect(partial).toHaveAttribute("data-level", "unknown");
  expect(partial).toHaveTextContent("Used10.0 GiB");
  expect(partial).not.toHaveTextContent("%");
  expect(partial).toHaveTextContent("Usage percent not reported");
  expect(within(partial).getAllByText("Not reported")).toHaveLength(3);
  expect(partial).toHaveTextContent("Total not reported · Preserved sandboxes not reported");
});

test("normal usage shows used, reserved, preserved and free bytes with percent and preserved count", () => {
  render(<StorageCapacity central={disk(40)} nodes={[]} />);
  const central = row("Central");
  expect(central).toHaveAttribute("data-level", "normal");
  expect(central).toHaveTextContent("Used40.0 GiB · 40%");
  expect(central).toHaveTextContent("Reserved32.0 GiB · 32%");
  expect(central).toHaveTextContent("Preserved4.0 GiB · 4%");
  expect(central).toHaveTextContent("Free60.0 GiB · 60%");
  expect(central).toHaveTextContent("100 GiB total · 1 preserved sandbox");
  expect(central).not.toHaveTextContent("Storage pressure");
  expect(central).not.toHaveTextContent("Placement refused");
});

test("80% used highlights storage pressure without claiming refusal", () => {
  render(<StorageCapacity central={unreportedStorage} nodes={[{ id: "n1", name: "VPS", storage: disk(80) }, { id: "n2", name: "Almost", storage: { ...disk(84), used_bytes: 84.99 * GiB } }]} />);
  for (const name of ["VPS", "Almost"]) {
    const node = row(name);
    expect(node).toHaveAttribute("data-level", "warning");
    expect(node).toHaveTextContent("Storage pressure · at or above 80% used");
    expect(node).not.toHaveTextContent("Placement refused");
  }
  expect(row("Almost")).toHaveTextContent("· 84%");
});

test("85% used highlights placement refusal and sorts the most used node first", () => {
  render(<StorageCapacity central={unreportedStorage} nodes={[{ id: "n1", name: "Quiet", storage: disk(10) }, { id: "n2", name: "Full", storage: { ...disk(85), preserved_count: 3 } }]} />);
  const full = row("Full");
  expect(full).toHaveAttribute("data-level", "refusal");
  expect(full).toHaveTextContent("Placement refused · at or above 85% used");
  expect(full).toHaveTextContent("3 preserved sandboxes");
  const names = within(screen.getByRole("region", { name: "Disk storage" })).getAllByRole("listitem").map(item => item.querySelector("strong")!.textContent);
  expect(names).toEqual(["Central", "Full", "Quiet"]);
});

test("unavailable node inventory keeps central and states the gap", () => {
  render(<StorageCapacity central={unreportedStorage} nodes={null} nodesUnavailable="Node storage unavailable." />);
  expect(screen.getByText("Node storage unavailable.")).toBeVisible();
  expect(row("Central")).toBeVisible();
});
