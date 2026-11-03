import { ContractError, isRecord } from './contract';
import type { EntityRef } from '../wire/proposed';
/** Digest revisions are valid only for references, never authorization/lifecycle versions. */
export function reference(raw: unknown): EntityRef {
 if (!isRecord(raw) || typeof raw.type !== 'string' || typeof raw.id !== 'string' || !raw.id ||
   (raw.revision != null && (typeof raw.revision !== 'string' || !/^(?:[1-9][0-9]*|sha256:[0-9a-f]{64})$/.test(raw.revision)))) {
  throw new ContractError('Invalid entity reference or revision');
 }
 return {type:raw.type,id:raw.id,...(typeof raw.revision==='string'?{revision:raw.revision}:{})};
}
export function timestamp(raw: unknown): string | null {
 if (raw == null) return null;
 if (typeof raw!=='string' || !Number.isFinite(Date.parse(raw))) throw new ContractError('Invalid observation timestamp');
 return raw;
}
