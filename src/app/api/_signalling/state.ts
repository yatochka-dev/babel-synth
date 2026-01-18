export type PeerId = string;
export type RoomId = string;

export type SignalMessage = {
  type: string;
  from: PeerId;
  to?: PeerId;
  payload?: any;
};

type PeerConn = {
  peerId: PeerId;
  send: (msg: SignalMessage) => void;
  close: () => void;
};

type RoomState = {
  peers: Map<PeerId, PeerConn>;
  order: PeerId[];
};

declare global {
  // eslint-disable-next-line no-var
  var __SIGNALING_ROOMS__: Map<RoomId, RoomState> | undefined;
}

function getGlobalRooms(): Map<RoomId, RoomState> {
  if (!globalThis.__SIGNALING_ROOMS__) {
    globalThis.__SIGNALING_ROOMS__ = new Map();
  }
  return globalThis.__SIGNALING_ROOMS__;
}

export function getOrCreateRoom(roomId: RoomId): RoomState {
  const rooms = getGlobalRooms();
  let room = rooms.get(roomId);
  if (!room) {
    room = { peers: new Map(), order: [] };
    rooms.set(roomId, room);
  }
  return room;
}

export function getRoom(roomId: RoomId): RoomState | undefined {
  return getGlobalRooms().get(roomId);
}

export function deleteRoomIfEmpty(roomId: RoomId) {
  const rooms = getGlobalRooms();
  const room = rooms.get(roomId);
  if (room && room.peers.size === 0) rooms.delete(roomId);
}

export function broadcast(
  roomId: RoomId,
  msg: SignalMessage,
  exceptPeer?: PeerId,
) {
  const room = getRoom(roomId);
  if (!room) return;
  for (const [pid, conn] of room.peers.entries()) {
    if (exceptPeer && pid === exceptPeer) continue;
    conn.send(msg);
  }
}

export function sendTo(roomId: RoomId, to: PeerId, msg: SignalMessage) {
  const room = getRoom(roomId);
  if (!room) return;
  room.peers.get(to)?.send(msg);
}
