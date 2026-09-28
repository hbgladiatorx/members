/**
 * Thin indirection so HTTP routes can broadcast without importing the socket server.
 * Each channel is a Socket.IO room named `ch:<channelId>`; each user also has a
 * personal room `user:<userId>` for things like "you were added to a channel".
 */
import type { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(server: Server | null) {
  io = server;
}

export function emitToChannel(channelId: string, event: string, payload: unknown) {
  io?.to(`ch:${channelId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Make every live socket of these users join a channel room (e.g. after being added). */
export function joinUsersToChannel(userIds: string[], channelId: string) {
  if (!io) return;
  for (const uid of userIds) io.in(`user:${uid}`).socketsJoin(`ch:${channelId}`);
}

/** Remove a user's live sockets from a channel room (e.g. after removal from a class). */
export function removeUserFromChannel(userId: string, channelId: string) {
  io?.in(`user:${userId}`).socketsLeave(`ch:${channelId}`);
}
