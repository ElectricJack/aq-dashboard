import { apiGet } from './client';
import { ContractError, isRecord, boundedList } from './adapters/contract';

export type ConversationMessage = { role: 'user' | 'assistant'; text: string };
export type Conversation = { messages: ConversationMessage[]; partial: boolean };

export type ConversationSource = 'manual' | 'native';

function validMessage(value: unknown): value is ConversationMessage {
  if (!isRecord(value) || typeof value.text !== 'string') return false;
  return value.role === 'user' || value.role === 'assistant';
}

function validMessages(messages: unknown): boolean {
  return boundedList(messages, 1000, validMessage) && messages.length > 0;
}

function snapshot(value: unknown): Conversation {
  const hasStatus = isRecord(value) && typeof value.partial === 'boolean';
  if (hasStatus && validMessages(value.messages)) return value as Conversation;
  throw new ContractError('Invalid conversation snapshot');
}

function sessionResponse(value: unknown, id: string): value is Record<string, unknown> {
  return isRecord(value) && value.session_id === id && typeof value.project_id === 'string';
}

export async function sessionConversation(source: ConversationSource, id: string, project: string | undefined, signal: AbortSignal) {
  const base = source === 'manual' ? '/api/manual-agents' : '/api/v1/sessions';
  const value = await apiGet<unknown>(`${base}/${encodeURIComponent(id)}/conversation`, signal);
  if (!sessionResponse(value, id)) {
    throw new ContractError('Invalid conversation session');
  }
  if (project && value.project_id !== project) return { kind: 'outside_project' } as const;
  const conversation = value.conversation;
  if (conversation === null) return { kind: 'unavailable' } as const;
  return { kind: 'available', conversation: snapshot(conversation) } as const;
}
