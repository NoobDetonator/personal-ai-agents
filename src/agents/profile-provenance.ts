import type { AgentConfig } from '../config/defaults.js';
import { listProfiles, type ProfileInfo } from './prompt-composer.js';

export type AgentProfileStatus =
  | 'manual'
  | 'current'
  | 'outdated'
  | 'missing'
  | 'untracked';

export interface AgentProfileProvenance {
  source: 'manual' | 'library';
  status: AgentProfileStatus;
  profileId: string | null;
  profileTitle: string | null;
  profileFile: string | null;
  appliedRevision: string | null;
  currentRevision: string | null;
}

export function resolveAgentProfileProvenance(
  config: Pick<AgentConfig, 'profile' | 'profileRevision'>,
  profiles: ProfileInfo[] = listProfiles(),
): AgentProfileProvenance {
  const profileId = config.profile?.trim() || null;
  const appliedRevision = config.profileRevision?.trim() || null;

  if (!profileId) {
    return {
      source: 'manual',
      status: 'manual',
      profileId: null,
      profileTitle: null,
      profileFile: null,
      appliedRevision: null,
      currentRevision: null,
    };
  }

  const current = profiles.find(profile => profile.id === profileId.toLowerCase());
  if (!current) {
    return {
      source: 'library',
      status: 'missing',
      profileId,
      profileTitle: profileId,
      profileFile: null,
      appliedRevision,
      currentRevision: null,
    };
  }

  const status: AgentProfileStatus = !appliedRevision
    ? 'untracked'
    : appliedRevision === current.revision
      ? 'current'
      : 'outdated';

  return {
    source: 'library',
    status,
    profileId: current.id,
    profileTitle: current.title,
    profileFile: current.file,
    appliedRevision,
    currentRevision: current.revision,
  };
}
