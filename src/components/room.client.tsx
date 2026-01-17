"use client";
import { useState } from "react";

interface RoomProps {
  id: string;
}

export default function Room({ id }: RoomProps) {
  const [s, setS] = useState(0);

  return (
    <div>
      Rooawdawdm {id} {s} <button onClick={() => setS(s + 1)}>inc</button>
    </div>
  );
}
