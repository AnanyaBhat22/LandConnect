/**
 * One Socket.IO connection per signed-in user, shared by calls (and chat).
 *
 * - Authenticates with the same JWT as the REST API.
 * - `auth` is a function, so every reconnect sends the *latest* access token.
 * - If the server refuses the token (expired), we refresh it and reconnect.
 */
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

import { refreshTokens } from '../api/client';
import { getAccessToken } from '../api/tokenStore';
import { useAuth } from '../auth/AuthContext';
import { API_URL } from '../config';

interface SocketValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketValue>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn') return;

    const s = io(API_URL, {
      transports: ['websocket'], // skip long-polling: faster and simpler on mobile
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', async (err) => {
      if (err.message === 'unauthorized') {
        if (await refreshTokens()) s.connect();
        else await logout();
      }
    });

    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [status, logout]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);
