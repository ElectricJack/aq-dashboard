import { apiGet } from './client';
import { ContractError, isRecord } from './adapters/contract';

export type ConversationMessage = { role: 'user' | 'assistant'; text: string };
export type Conversation = { messages: ConversationMessage[]; partial: boolean };

export async function sessionConversation(id: string, project: string | undefined, signal: AbortSignal) {
  const value = await apiGet<unknown>(`/api/manual-agents/${encodeURIComponent(id)}/conversation`, signal);
  if (!isRecord(value) || value.session_id !== id || typeof value.project_id !== 'string') {
    throw new ContractError('Invalid conversation session');
  }
  if (project && value.project_id !== project) return { kind: 'outside_project' } as const;
  const conversation = value.conversation;
  if (conversation === null) return { kind: 'unavailable' } as const;
  if (!isRecord(conversation) || typeof conversation.partial !== 'boolean'
    || !Array.isArray(conversation.messages) || !conversation.messages.length || conversation.messages.length > 1000
    || !conversation.messages.every((message: unknown) => isRecord(message)
      && (message.role === 'user' || message.role === 'assistant') && typeof message.text === 'string')) {
    throw new ContractError('Invalid conversation snapshot');
  }
  return { kind: 'available', conversation: conversation as Conversation } as const;
}
