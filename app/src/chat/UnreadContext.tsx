/**
 * Total unread chat messages, for the badge on the Chats tab.
 * Refreshed from the server on start, whenever a message arrives over the
 * socket, and whenever a screen marks a conversation as read.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../realtime/SocketContext';

const UnreadContext = createContext<{ unread: number; refresh: () => void }>({ unread: 0, refresh: () => {} });

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const { socket } = useSocket();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    if (status !== 'signedIn') return;
    api<{ unread: number }>('/conversations/unread-count')
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  }, [status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = () => refresh();
    socket.on('message:new', onMessage);
    socket.on('connect', onMessage); // catch up after a reconnect
    return () => {
      socket.off('message:new', onMessage);
      socket.off('connect', onMessage);
    };
  }, [socket, refresh]);

  return <UnreadContext.Provider value={{ unread, refresh }}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);
