"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LobbyForm() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    const targetRoom = roomId || Math.random().toString(36).substring(2, 7);
    router.push(`/room/${targetRoom}?name=${encodeURIComponent(name)}`);
  };

  return (
    <div className="rounded-xl bg-white/10 p-8 text-white backdrop-blur-md">
      <h2 className="mb-6 text-center text-3xl font-bold">Join Room</h2>
      <form onSubmit={handleJoin} className="flex flex-col gap-4">
        <div>
          <label className="mb-2 block text-sm font-medium">Display Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/20 p-3 text-white placeholder-white/50 focus:border-purple-500 focus:outline-none"
            placeholder="Enter your name"
            required
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium">
            Room ID (Optional)
          </label>
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full rounded-lg border border-white/20 bg-black/20 p-3 text-white placeholder-white/50 focus:border-purple-500 focus:outline-none"
            placeholder="Leave empty to create new"
          />
        </div>
        <button
          type="submit"
          className="mt-4 rounded-lg bg-purple-600 p-3 font-semibold text-white transition hover:bg-purple-700"
        >
          {roomId ? "Join Room" : "Create Room"}
        </button>
      </form>
    </div>
  );
}
