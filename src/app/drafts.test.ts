import { activateDrafts, clearDrafts, draftIdentity, draftStorageKey, readDraft, saveDraftsBeforeReload, writeDraft } from "./drafts";

const a = { principalId: "alice", authorizationRevision: "9007199254740993", contractVersion: "old-1" };
afterEach(() => clearDrafts());

test("an old composer cannot recreate private content after logout or identity replacement", () => {
  activateDrafts(draftIdentity(a)); const key = draftStorageKey(a, "composer");
  writeDraft(key, '"Alice private text"'); clearDrafts();
  writeDraft(key, '"Delayed Alice response"');
  expect(sessionStorage.getItem(key)).toBeNull();
  activateDrafts(draftIdentity({ ...a, principalId: "bob" }));
  writeDraft(key, '"Old owner update"');
  expect(sessionStorage.getItem(key)).toBeNull();
});

test("contract upgrades retain a draft but principal and exact revision changes erase it", () => {
  activateDrafts(draftIdentity(a)); const key = draftStorageKey(a, "composer");
  writeDraft(key, '"Unsent"');
  expect(draftStorageKey({ ...a, contractVersion: "new-2" }, "composer")).toBe(key);
  activateDrafts(draftIdentity(a)); expect(readDraft(key)).toBe('"Unsent"');
  activateDrafts(draftIdentity({ ...a, authorizationRevision: "9007199254740994" }));
  expect(sessionStorage.getItem(key)).toBeNull();
});

test("draft cleanup preserves unrelated session values and never writes localStorage", () => {
  localStorage.clear(); sessionStorage.setItem("other-app", "keep");
  activateDrafts(draftIdentity(a)); writeDraft(draftStorageKey(a, "composer"), '"Draft"');
  expect(saveDraftsBeforeReload()).toBe(true); clearDrafts();
  expect(sessionStorage.getItem("other-app")).toBe("keep"); expect(localStorage.length).toBe(0);
});

test("blocked sessionStorage keeps editing in memory and refuses reload until storage recovers", () => {
  const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function(this: Storage, key) { if (this === sessionStorage) throw new DOMException("Blocked", "SecurityError"); return originalGet.call(this,key); });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function(this: Storage, key, value) { if (this === sessionStorage) throw new DOMException("Blocked", "SecurityError"); originalSet.call(this,key,value); });
  activateDrafts(draftIdentity(a)); const key = draftStorageKey(a,"composer"); writeDraft(key,'"Retained in memory"');
  expect(readDraft(key)).toBe('"Retained in memory"'); expect(saveDraftsBeforeReload()).toBe(false);
  get.mockRestore(); set.mockRestore(); expect(saveDraftsBeforeReload()).toBe(true); expect(sessionStorage.getItem(key)).toBe('"Retained in memory"');
});
