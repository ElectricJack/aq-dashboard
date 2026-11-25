import type { SessionDetailView } from "../../../api/adapters/inspection";
import { freezeMessage, MESSAGE_MAX_BYTES, messageState } from "./message";
import { MailAction } from "./MailAction";

/** The session's durable Message slot (RA-14): a mailbox message through the action API, never terminal input. */
export function MessageComposer({ session: s }: { session: SessionDetailView }) {
  return <MailAction kind="message" maxBytes={MESSAGE_MAX_BYTES} freeze={body => freezeMessage(s, body)} describe={messageState} />;
}
