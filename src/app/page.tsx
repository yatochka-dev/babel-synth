import LobbyForm from "~/components/LobbyForm";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#1a1b26] to-[#000000] text-white">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <h1 className="text-5xl font-extrabold tracking-tight text-white sm:text-[5rem]">
          Babel <span className="text-purple-400">Synth</span>
        </h1>
        <p className="text-lg text-white/70">
          Real-time video chat with experimental features.
        </p>

        <LobbyForm />
      </div>
    </main>
  );
}
