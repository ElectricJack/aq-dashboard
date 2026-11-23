import { launchProfileKey, type ManualFleet } from "./manualFleet";

type Worker = ManualFleet["workers"][number];
export function workerProjects(fleet: ManualFleet | undefined, worker?: Worker) {
  if (!fleet || !worker) return [];
  return fleet.projects.filter(project => worker.repositories.includes(project.repository_id));
}

export function launchOptions(fleet: ManualFleet | undefined, worker: Worker | undefined, selected: { provider: string; profile: string }) {
  const providers = worker?.providers ?? [];
  const provider = providers.includes(selected.provider) ? selected.provider : providers[0];
  const profiles = fleet?.launch_profiles.filter(profile => profile.provider === provider) ?? [];
  const choice = profiles.find(profile => launchProfileKey(profile) === selected.profile)
    ?? profiles.find(profile => profile.profile_id === "standard-medium") ?? profiles[0];
  return { providers, provider, profiles, choice };
}
