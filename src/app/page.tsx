"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Toaster } from "~/components/ui/sonner";

function sanitizeRoomName(raw: string) {
  if (!raw) return "";
  const s = raw.trim().toLowerCase();
  const dashed = s.replace(/\s+/g, "-");
  const cleaned = dashed.replace(/[^a-z0-9-]/g, "");
  const collapsed = cleaned.replace(/-+/g, "-");
  return collapsed.replace(/(^-+|-+$)/g, "");
}

export default function Page() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (raw: string) => {
    const name = sanitizeRoomName(raw);
    if (!name) return "Please enter a room name (letters, numbers or spaces).";
    if (name.length < 2) return "Room name must be at least 2 characters.";
    if (name.length > 24) return "Room name must be at most 24 characters.";
    return null;
  };

  const focusInput = () => {
    const el = document.getElementById("room-input") as HTMLInputElement | null;
    el?.focus();
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    const err = validate(value);
    if (err) {
      setError(err);
      focusInput();
      return;
    }

    const sanitized = sanitizeRoomName(value);
    setSubmitting(true);
    try {
      router.push(`/room/${encodeURIComponent(sanitized)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="border-border bg-card rounded-lg border p-8">
          <header className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight">HackUnited</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Create or join a two-person voice room
            </p>
          </header>

          <form onSubmit={(e) => void onSubmit(e)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="room-input">Room name</Label>
              <Input
                id="room-input"
                placeholder="Enter room name"
                value={value}
                onChange={(ev) => setValue(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") void onSubmit();
                }}
                maxLength={48}
                aria-invalid={!!error}
                aria-describedby={error ? "room-error" : "room-hint"}
              />
              <p id="room-hint" className="text-muted-foreground text-xs">
                2–24 characters · letters, numbers and dashes
              </p>
              {error && (
                <p id="room-error" className="text-destructive text-sm">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? "Joining..." : "Create / Join Room"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValue("");
                  setError(null);
                  focusInput();
                }}
              >
                Clear
              </Button>
            </div>
          </form>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          Share the room URL to invite someone
        </p>
      </div>

      <Toaster />
    </main>
  );
}
