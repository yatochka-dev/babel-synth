import { NextResponse } from "next/server";
import {
  deleteRoomIfEmpty,
  sendTo,
  broadcast,
  type SignalMessage,
  getOrCreateRoom,
} from "../_signalling/state";

export const runtime = "nodejs";

function sseFormat(data: any) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const roomId = searchParams.get("room")?.trim();
  const peerId = searchParams.get("peer")?.trim();

  if (!roomId || !peerId) {
    return NextResponse.json(
      { error: "Missing room or peer" },
      { status: 400 },
    );
  }

  const room = getOrCreateRoom(roomId);

  if (room.peers.has(peerId)) {
    try {
      room.peers.get(peerId)!.close();
    } catch {}
    room.peers.delete(peerId);
    room.order = room.order.filter((p) => p !== peerId);
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (msg: SignalMessage) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseFormat(msg)));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      room.peers.set(peerId, { peerId, send, close });
      if (!room.order.includes(peerId)) room.order.push(peerId);

      // Send a hello so the client knows SSE is live
      send({ type: "sse-ready", from: "server" });

      // Keepalive ping (prevents proxies from closing)
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
        } catch {}
      }, 15000);

      const onAbort = () => {
        clearInterval(ping);

        room.peers.delete(peerId);
        room.order = room.order.filter((p) => p !== peerId);

        // Notify others
        broadcast(roomId, { type: "peer-left", from: peerId }, peerId);

        deleteRoomIfEmpty(roomId);
        close();
      };

      // @ts-ignore
      req.signal?.addEventListener?.("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    room: string;
    from: string;
    to?: string;
    type: string;
    payload?: any;
  } | null;

  if (!body?.room || !body?.from || !body?.type) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const msg: SignalMessage = {
    type: body.type,
    from: body.from,
    to: body.to,
    payload: body.payload,
  };

  // Direct send or broadcast
  if (body.to) {
    sendTo(body.room, body.to, msg);
  } else {
    broadcast(body.room, msg, body.from);
  }

  return NextResponse.json({ ok: true });
}
