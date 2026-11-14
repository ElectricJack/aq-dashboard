import { adaptProviderSettings } from "./providerSettings";
import { ContractError } from "./adapters/contract";
const snapshot = () => ({ revision: "3", available_revision: "a".repeat(64), providers: ["openai"], available: [{ id: "openai", name: "OpenAI", accounts: ["Team"], credential_status: "present" }] });
test("a removed server connection remains representable until the owner removes its membership", () => {
  const raw = snapshot(); raw.available = []; expect(adaptProviderSettings(raw).providers).toEqual(["openai"]);
});
test.each(["duplicate", "control", "revision", "credential status"])("rejects malformed provider metadata: %s", kind => {
  const raw = snapshot();
  if (kind === "duplicate") raw.available.push(raw.available[0]!);
  if (kind === "control") raw.available[0]!.accounts = ["account\nname"];
  if (kind === "revision") raw.revision = "-1";
  if (kind === "credential status") raw.available[0]!.credential_status = "authenticated";
  expect(() => adaptProviderSettings(raw)).toThrow(ContractError);
});
