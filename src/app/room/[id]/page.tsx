import Room from "~/components/room.client";
import Link from "next/link";
import { Button } from "~/components/ui/button";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="border-border bg-card rounded-lg border p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Room</h1>
              <p className="text-muted-foreground text-sm">/{id}</p>
            </div>

            <Link href="/">
              <Button variant="outline" size="sm">
                ← Back
              </Button>
            </Link>
          </div>

          <Room id={id} />
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          Share this URL to invite someone to your room
        </p>
      </div>
    </main>
  );
}
