import { useEffect, useRef } from "react";

export type RawState = {
  pinch: number;
  handOpen: number;
  handHeight: number;
  smile: number;
  tension: number;
  shoulderWidth: number;
  armRaise: number;
};

function makeClientId() {
  return crypto.randomUUID();
}

export function useRoomRawSender(
  roomId: string,
  state: RawState,
  wsBaseUrl: string,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef(state);
  const clientIdRef = useRef(makeClientId());

  // always keep latest state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!roomId) return;

    const ws = new WebSocket(
      `${wsBaseUrl.replace(/\/$/, "")}/ws/${roomId}/${clientIdRef.current}`,
    );
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const data = JSON.parse(ev.data);
        if (data.type === "tick") console.log("tick", data);
      }
    };

    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;

      ws.send(
        JSON.stringify({
          type: "raw",
          ...stateRef.current,
        }),
      );
    }, 150); // ~33Hz

    return () => {
      clearInterval(interval);
      ws.close();
      wsRef.current = null;
    };
  }, [roomId, wsBaseUrl]);

  return {
    clientId: clientIdRef.current,
  };
}
