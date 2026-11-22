import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CopyPlus, MessageCircleQuestion, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createGameRoom, saveRoomAccess } from "@/lib/game";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Truth or Dare | Play with Friends" },
      { name: "description", content: "Start a private Truth or Dare room and invite friends to play." },
      { property: "og:title", content: "Truth or Dare | Play with Friends" },
      { property: "og:description", content: "Start a private Truth or Dare room and invite friends to play." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("Friday night");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const room = await createGameRoom(roomName, nickname);
      saveRoomAccess(room.inviteCode, { playerId: room.playerId, hostSecret: room.hostSecret });
      await navigate({ to: "/room/$code", params: { code: room.inviteCode } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a room. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = inviteCode.trim().toLowerCase();
    if (!/^[a-f0-9]{10}$/.test(code)) {
      setError("Enter the 10-character room code from your friend.");
      return;
    }
    void navigate({ to: "/room/$code", params: { code } });
  }

  return (
    <div className="min-h-screen px-5 pb-10 pt-5 sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-primary text-sm font-black text-primary-foreground">
            T/D
          </div>
          <span className="font-semibold">Truth or Dare</span>
        </div>
        <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
          <span className="size-2 rounded-full bg-primary" />
          No player accounts
        </span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 py-10 lg:grid-cols-[0.84fr_1.16fr] lg:items-center lg:gap-14 lg:py-16">
        <section className="flex flex-col gap-7">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase text-muted-foreground">
            <Zap className="size-4 text-accent" aria-hidden="true" />
            Pick a side
          </div>
          <div>
            <h1 className="font-display text-6xl leading-[0.95] sm:text-7xl">
              Truth <span className="text-primary">or</span>
              <br /> Dare?
            </h1>
            <p className="mt-5 max-w-md text-lg leading-7 text-muted-foreground">
              One room, your friends, and whatever the bot deals next.
            </p>
          </div>
          <div className="grid max-w-sm grid-cols-2 gap-3" aria-label="Truth and dare cards">
            <div className="deal-in flex aspect-[0.9] flex-col justify-between rounded-lg bg-truth p-5 text-truth-foreground shadow-game">
              <MessageCircleQuestion className="size-6" aria-hidden="true" />
              <div>
                <span className="font-display text-5xl">T</span>
                <p className="mt-1 text-sm font-semibold">Tell the truth</p>
              </div>
            </div>
            <div className="deal-in mt-8 flex aspect-[0.9] flex-col justify-between rounded-lg bg-dare p-5 text-dare-foreground shadow-game">
              <Zap className="size-6" aria-hidden="true" />
              <div>
                <span className="font-display text-5xl">D</span>
                <p className="mt-1 text-sm font-semibold">Take the dare</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2" aria-label="Start or join a game">
          <form onSubmit={handleCreate} className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-game sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-primary">01 / HOST</p>
                <h2 className="mt-2 font-display text-3xl">Make a room</h2>
              </div>
              <CopyPlus className="mt-1 size-5 text-primary" aria-hidden="true" />
            </div>
            <div className="grid gap-4">
              <label className="grid gap-2 text-sm font-medium" htmlFor="room-name">
                Room name
                <Input
                  id="room-name"
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  minLength={2}
                  maxLength={40}
                  required
                  placeholder="Friday night"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium" htmlFor="host-name">
                Your nickname
                <Input
                  id="host-name"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  minLength={2}
                  maxLength={24}
                  required
                  placeholder="What should friends call you?"
                />
              </label>
            </div>
            <Button type="submit" className="mt-auto w-full" disabled={busy}>
              {busy ? "Making your room…" : "Create room"}
              {!busy && <ArrowRight aria-hidden="true" />}
            </Button>
          </form>

          <form onSubmit={handleJoin} className="flex flex-col gap-5 rounded-lg border border-border bg-secondary p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-secondary-foreground">02 / JOIN</p>
                <h2 className="mt-2 font-display text-3xl">Got a code?</h2>
              </div>
              <ArrowRight className="mt-1 size-5 text-secondary-foreground" aria-hidden="true" />
            </div>
            <label className="grid gap-2 text-sm font-medium" htmlFor="invite-code">
              Room code
              <Input
                id="invite-code"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.replace(/[^a-fA-F0-9]/g, "").slice(0, 10))}
                maxLength={10}
                required
                placeholder="10-character code"
                autoCapitalize="characters"
                className="font-mono uppercase"
              />
            </label>
            <div className="min-h-20 rounded-md border border-border bg-background/70 p-3 text-sm leading-6 text-muted-foreground">
              Add your nickname after you arrive. No account needed.
            </div>
            <Button type="submit" variant="outline" className="mt-auto w-full">
              Join room
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </section>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm text-muted-foreground">
        <span>Keep it kind. Anyone can skip a prompt.</span>
        <span className="font-display text-lg text-foreground">Your turn.</span>
      </footer>
    </div>
  );
}