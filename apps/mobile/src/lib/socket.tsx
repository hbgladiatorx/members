/**
 * One Socket.IO connection per signed-in user, shared app-wide.
 * Reconnects with a freshly refreshed access token when the old one expires.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession } from './api';
import { useAuth } from './auth';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!user) return;
    const s = io(API_URL, {
      transports: ['websocket'],
      // Called on every (re)connect attempt, so it always sends the current token.
      auth: (cb) => cb({ token: getAccessToken() }),
    });
    s.on('connect_error', async (err) => {
      if (err.message === 'unauthorized' && (await refreshSession())) s.connect();
    });
    setSocket(s);
    return () => {
      s.close();
      setSocket(null);
    };
  }, [user]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export const useSocket = () => useContext(SocketContext);

/** Subscribe to a socket event for the lifetime of the component. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const socket = useSocket();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}
