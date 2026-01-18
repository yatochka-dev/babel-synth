import { NextResponse } from "next/server";
import { broadcast, getOrCreateRoom } from "../../_signalling/state";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    room: string;
    peer: string;
  } | null;

  const roomId = body?.room?.trim();
  const peerId = body?.peer?.trim();

  if (!roomId || !peerId) {
    return NextResponse.json(
      { error: "Missing room or peer" },
      { status: 400 },
    );
  }

  const room = getOrCreateRoom(roomId);

  const uniquePeers = new Set(room.order);
  uniquePeers.add(peerId);

  if (uniquePeers.size > 2) {
    return NextResponse.json({ error: "Room full (max 2)" }, { status: 403 });
  }

  // Ensure order has this peer
  if (!room.order.includes(peerId)) room.order.push(peerId);

  const initiator = room.order[0] === peerId;
  const others = room.order.filter((p) => p !== peerId);

  // Notify other peers that someone joined (so initiator can create offer)
  broadcast(roomId, { type: "peer-joined", from: peerId }, peerId);

  return NextResponse.json({
    initiator,
    others,
  });
}
