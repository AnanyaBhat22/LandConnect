import type { ChatMessage } from '../api/types';

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** WhatsApp-style list time: today → time, yesterday → "Yesterday", else date. */
export function listTimeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return timeLabel(iso);
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

type CallLogBody = { kind: 'AUDIO' | 'VIDEO'; status: string; caller_id: string; duration: number | null };

/** Render a CALL_LOG message from the viewer's perspective. */
export function describeCall(msg: ChatMessage, myId: string): { text: string; missed: boolean; video: boolean } {
  let log: CallLogBody;
  try {
    log = JSON.parse(msg.body);
  } catch {
    return { text: 'Call', missed: false, video: false };
  }
  const video = log.kind === 'VIDEO';
  const kind = video ? 'video call' : 'voice call';
  const outgoing = log.caller_id === myId;
  const dur = log.duration ? ` · ${log.duration < 60 ? `${log.duration}s` : `${Math.floor(log.duration / 60)}m ${log.duration % 60}s`}` : '';
  switch (log.status) {
    case 'COMPLETED':
      return { text: `${outgoing ? 'Outgoing' : 'Incoming'} ${kind}${dur}`, missed: false, video };
    case 'MISSED':
      return { text: outgoing ? `No answer · ${kind}` : `Missed ${kind}`, missed: !outgoing, video };
    case 'REJECTED':
      return { text: outgoing ? `${cap(kind)} declined` : `You declined a ${kind}`, missed: false, video };
    case 'CANCELLED':
      return { text: outgoing ? `Cancelled ${kind}` : `Missed ${kind}`, missed: !outgoing, video };
    default:
      return { text: cap(kind), missed: false, video };
  }
}

/** One-line preview for the chat list. */
export function previewText(msg: ChatMessage | null, myId: string): string {
  if (!msg) return 'Say hello 👋';
  if (msg.type === 'CALL_LOG') return `📞 ${describeCall(msg, myId).text}`;
  if (msg.type === 'SYSTEM') return msg.body;
  const you = msg.sender_id === myId ? 'You: ' : '';
  if (msg.type === 'IMAGE') return `${you}📷 Photo`;
  if (msg.type === 'VIDEO') return `${you}🎥 Video`;
  if (msg.type === 'FILE') {
    try {
      return `${you}📄 ${JSON.parse(msg.body).name}`;
    } catch {
      return `${you}📄 Document`;
    }
  }
  return `${msg.sender_id === myId ? 'You: ' : ''}${msg.body}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
