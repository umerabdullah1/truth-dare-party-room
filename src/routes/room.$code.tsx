import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Crown,
  LoaderCircle,
  MessageCircleQuestion,
  Users,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  advanceGameTurn,
  getGameRoom,
  joinGameRoom,
  readRoomAccess,
  saveRoomAccess,
  type GameRoom,
  type RoomAccess,
} from "@/lib/game";

export const Route = createFileRoute("/room/$code")({
  head: () => ({
    meta: [
      { title: "Your Game Room | Truth or Dare" },
      { name: "description", content: "Join friends for a shared Truth or Dare game." },
      { property: "og:title", content: "Your Game Room | Truth or Dare" },
      { property: "og:description", content: "Join friends for a shared Truth or Dare game." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { code } = Route.useParams();
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [access, setAccess] = useState<RoomAccess | null>(null);
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const savedAccess = readRoomAccess(code);
    if (savedAccess) setAccess(savedAccess);

    async function refresh() {
      try {
        const currentRoom = await getGameRoom(code);
        if (!active) return;
        setRoom(currentRoom);
        setLoading(false);
        if (!currentRoom) setError("This room link could not be found.");
      } catch (cause) {
        if (!active) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "This room could not be loaded.");
      }
    }

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 2500);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [code]);

  const currentPlayer = useMemo(
    () => room?.players.find((player) => player.id === room.current_player_id) ?? null,
    [room],
  );
  const myPlayer = useMemo(
    () => room?.players.find((player) => player.id === access?.playerId) ?? null,
    [room, access],
  );
  const host = Boolean(access?.hostSecret && myPlayer);

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setJoining(true);
    try {
      const result = await joinGameRoom(code, nickname);
      const newAccess = { playerId: result.playerId, hostSecret: null };
      saveRoomAccess(code, newAccess);
      setAccess(newAccess);
      setNickname("");
      const latestRoom = await getGameRoom(code);
      setRoom(latestRoom);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join the room. Try again.");
    } finally {
      setJoining(false);
    }
  }

  async function handleNextTurn() {
    if (!access?.hostSecret) return;
    setError(null);
    setNotice(null);
    setDealing(true);
    try {
      setRoom(await advanceGameTurn(code, access.hostSecret));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not deal the next prompt.");
    } finally {
      setDealing(false);
    }
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setNotice("Invite link copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copying is unavailable here. Share the room code instead.");
    }
  }

  if (loading && !room) {
    return (
      <main className="grid min-h-screen place-items-center px-5">
        <LoaderCircle className="size-8 animate-spin text-primary" aria-label="Loading room" />
      </main>
    );
  }

  if (!room) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-10">
        <Link to="/" className="mb-8 inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the game
        </Link>
        <h1 className="font-display text-5xl">Room not found</h1>
        <p className="mt-3 text-muted-foreground">Check the invite code and try again.</p>
        {error && <p role="alert" className="mt-5 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      </main>
    );
  }

  const joined = Boolean(myPlayer);
  return (
    <div className="min-h-screen px-5 pb-10 pt-5 sm:px-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-border pb-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Exit room
        </Link>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" /> Room {room.invite_code.toUpperCase()}
        </span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 py-8 lg:grid-cols-[1.25fr_0.75fr] lg:py-12">
        <section className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase text-muted-foreground">{room.status === "waiting" ? "Lobby" : `Round ${room.turn_number}`}</p>
              <h1 className="mt-2 font-display text-5xl sm:text-6xl">{room.room_name}</h1>
            </div>
            <Button type="button" variant="outline" onClick={handleCopyInvite}>
              {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
              {copied ? "Copied" : "Invite friends"}
            </Button>
          </div>

          {!joined ? (
            <form onSubmit={handleJoin} className="grid max-w-lg gap-5 rounded-lg border border-border bg-card p-5 shadow-game sm:p-7">
              <div>
                <p className="text-sm text-muted-foreground">You’re invited to</p>
                <h2 className="mt-1 font-display text-3xl">{room.room_name}</h2>
              </div>
              <label htmlFor="player-nickname" className="grid gap-2 text-sm font-medium">
                Your nickname
                <Input
                  id="player-nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  minLength={2}
                  maxLength={24}
                  required
                  placeholder="What should friends call you?"
                />
              </label>
              <Button type="submit" disabled={joining}>
                {joining ? "Joining…" : "Join the room"}
                {!joining && <ArrowLeft className="rotate-180" aria-hidden="true" />}
              </Button>
            </form>
          ) : (
            <>
              {room.status === "waiting" ? (
                <div className="flex min-h-72 flex-col justify-between rounded-lg border border-border bg-secondary p-6 sm:p-8">
                  <div className="flex items-center gap-3 text-secondary-foreground">
                    <Users className="size-5" aria-hidden="true" />
                    <span className="font-semibold">{room.players.length} {room.players.length === 1 ? "player" : "players"} here</span>
                  </div>
                  <div>
                    <h2 className="font-display text-4xl">The table is open.</h2>
                    <p className="mt-3 max-w-md text-muted-foreground">
                      {host ? "Bring in one more friend, then deal the first turn." : "Invite the others and get ready for your first turn."}
                    </p>
                  </div>
                  {host && (
                    <Button type="button" onClick={handleNextTurn} disabled={dealing || room.players.length < 2} className="w-fit">
                      {dealing ? "Dealing…" : "Start the game"}
                      {!dealing && <Zap aria-hidden="true" />}
                    </Button>
                  )}
                </div>
              ) : (
                <div key={room.turn_number} className={`deal-in flex min-h-80 flex-col justify-between rounded-lg p-6 shadow-game sm:p-9 ${room.current_kind === "truth" ? "bg-truth text-truth-foreground" : "bg-dare text-dare-foreground"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold uppercase">{room.current_kind === "truth" ? "Truth" : "Dare"} · Round {room.turn_number}</p>
                      <h2 className="mt-2 font-display text-4xl">{currentPlayer?.nickname ?? "Next player"}</h2>
                      <p className="mt-1 text-sm">{currentPlayer?.id === access?.playerId ? "You’re up" : "Pass the room to them"}</p>
                    </div>
                    {room.current_kind === "truth" ? <MessageCircleQuestion className="size-7" aria-hidden="true" /> : <Zap className="size-7" aria-hidden="true" />}
                  </div>
                  <p className="max-w-2xl font-display text-3xl leading-snug sm:text-4xl">{room.current_prompt}</p>
                  {host && (
                    <Button type="button" variant="outline" onClick={handleNextTurn} disabled={dealing} className="w-fit border-current bg-background/70 text-foreground hover:bg-background">
                      {dealing ? "Dealing…" : "Next turn"}
                      {!dealing && <ArrowRight aria-hidden="true" />}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        </section>

        <aside className="flex flex-col gap-5 lg:pt-3">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="font-display text-3xl">At the table</h2>
            <span className="text-sm text-muted-foreground">{room.players.length} joined</span>
          </div>
          {room.players.length > 0 ? (
            <ul className="divide-y divide-border">
              {room.players.map((player, index) => (
                <li key={player.id} className="flex items-center gap-3 py-3">
                  <span className={`grid size-10 place-items-center rounded-md text-sm font-bold ${player.id === room.current_player_id ? "bg-truth text-truth-foreground" : "bg-muted text-foreground"}`}>
                    {player.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{player.nickname}{player.id === access?.playerId ? " · You" : ""}</span>
                  {index === 0 && <Crown className="size-4 text-accent" aria-label="Room host" />}
                  {player.id === room.current_player_id && <span className="text-xs font-semibold text-primary">NOW</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No one has joined yet.</p>
          )}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">Room code</p>
              <p className="mt-1 font-mono text-lg font-semibold uppercase">{room.invite_code}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={handleCopyInvite} aria-label="Copy room invite link">
              <Clipboard aria-hidden="true" /> Copy link
            </Button>
          </div>
        </aside>
      </main>
    </div>
  );
}