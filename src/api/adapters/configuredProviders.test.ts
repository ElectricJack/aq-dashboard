import { adaptConfiguredProviders } from "./configuredProviders";
const account = { provider: "openai", account_reference: "team", enabled: true, provisionable: true, credential_profiles: 1 };
const page = () => ({ schema_version: 1, contract: "human-provider-accounts-1", source: "startup_configuration", server_time_ms: 123, revision: 1, accounts: [account] });
test("only bounded sanitized startup account metadata is accepted", () => {
  expect(adaptConfiguredProviders(page()).accounts).toEqual([account]);
  expect(adaptConfiguredProviders({ ...page(), revision: null, accounts: [] }).accounts).toEqual([]);
  for (const raw of [{ ...page(), source: "provider_rpc" }, { ...page(), revision: null }, { ...page(), accounts: [account, account] }, { ...page(), accounts: [{ ...account, enabled: false }] }, { ...page(), secret_file: "private" }, { ...page(), accounts: [{ ...account, authenticated: true }] }, { ...page(), accounts: [{ ...account, credential_profiles: 33 }] }]) expect(() => adaptConfiguredProviders(raw)).toThrow();
});
