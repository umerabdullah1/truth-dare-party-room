import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, CircleAlert, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { isConfiguredAdmin } from "@/lib/admin-access";
import type { PromptKind } from "@/lib/game";
import type { Tables } from "@/integrations/supabase/types";

type Profile = Pick<Tables<"profiles">, "id" | "display_name" | "avatar_url">;
type Prompt = Tables<"game_prompts">;
type AdminLoad =
  | { status: "signed-out" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready"; profile: Profile; prompts: Prompt[] };
type AdminState = AdminLoad["status"] | "loading";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Private Controls | Truth or Dare" },
      { name: "description", content: "Private prompt and profile controls for Truth or Dare." },
      { property: "og:title", content: "Private Controls | Truth or Dare" },
      { property: "og:description", content: "Private prompt and profile controls for Truth or Dare." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

async function loadAdminArea(): Promise<AdminLoad> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) return { status: "error", message: "Could not verify this account. Try again." };
  if (!user) return { status: "signed-out" };
  if (!isConfiguredAdmin(user.email)) {
    await supabase.auth.signOut();
    return { status: "denied" };
  }

  const { data: allowed, error: gateError } = await supabase.rpc("is_truth_dare_admin");
  if (gateError || allowed !== true) {
    await supabase.auth.signOut();
    return { status: "denied" };
  }

  const { data: existingProfile, error: profileError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) return { status: "error", message: "Your profile could not be loaded." };

  let profile = existingProfile;
  if (!profile) {
    const metadata = user.user_metadata;
    const displayName =
      (typeof metadata["full_name"] === "string" && metadata["full_name"]) ||
      (typeof metadata["name"] === "string" && metadata["name"]) ||
      user.email?.split("@")[0] ||
      "Admin";
    const avatarUrl = typeof metadata["avatar_url"] === "string" ? metadata["avatar_url"] : null;
    const { data: createdProfile, error: createProfileError } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: displayName, avatar_url: avatarUrl })
      .select("id, display_name, avatar_url")
      .single();
    if (createProfileError) return { status: "error", message: "Your profile could not be saved." };
    profile = createdProfile;
  }

  const { data: prompts, error: promptsError } = await supabase
    .from("game_prompts")
    .select("id, kind, prompt, active, created_at")
    .order("kind")
    .order("created_at", { ascending: true });
  if (promptsError) return { status: "error", message: "The prompt library could not be loaded." };
  return { status: "ready", profile, prompts: prompts ?? [] };
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[18px]">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}

function AdminPage() {
  const [status, setStatus] = useState<AdminState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newKind, setNewKind] = useState<PromptKind>("truth");
  const [activeKind, setActiveKind] = useState<PromptKind>("truth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  function applyLoad(result: AdminLoad) {
    setStatus(result.status);
    if (result.status === "ready") {
      setProfile(result.profile);
      setDisplayName(result.profile.display_name);
      setPrompts(result.prompts);
      setError(null);
    } else if (result.status === "error") {
      setError(result.message);
    }
  }

  useEffect(() => {
    let mounted = true;
    void loadAdminArea().then((result) => {
      if (mounted) applyLoad(result);
    }).catch(() => {
      if (mounted) applyLoad({ status: "error", message: "Could not check access. Try again." });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const shownPrompts = useMemo(
    () => prompts.filter((prompt) => prompt.kind === activeKind),
    [prompts, activeKind],
  );

  async function handleGoogleSignIn() {
    setBusy(true);
    setError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/admin`,
        extraParams: { prompt: "select_account" },
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      applyLoad(await loadAdminArea());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Google sign-in could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: saveError } = await supabase
        .from("profiles")
        .update({ display_name: displayName.trim(), updated_at: new Date().toISOString() })
        .eq("id", profile.id);
      if (saveError) throw saveError;
      setProfile({ ...profile, display_name: displayName.trim() });
      setNotice("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: insertError } = await supabase
        .from("game_prompts")
        .insert({ kind: newKind, prompt: newPrompt.trim() })
        .select("id, kind, prompt, active, created_at")
        .single();
      if (insertError) throw insertError;
      setPrompts((current) => [...current, data]);
      setNewPrompt("");
      setActiveKind(newKind);
      setNotice("Prompt added to the deck.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this prompt.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePrompt(prompt: Prompt) {
    const nextActive = !prompt.active;
    const { error: updateError } = await supabase
      .from("game_prompts")
      .update({ active: nextActive })
      .eq("id", prompt.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPrompts((current) => current.map((item) => (item.id === prompt.id ? { ...item, active: nextActive } : item)));
    setNotice(nextActive ? "Prompt is back in the deck." : "Prompt paused.");
    setError(null);
  }

  async function handleDeletePrompt(id: string) {
    const { error: deleteError } = await supabase.from("game_prompts").delete().eq("id", id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPrompts((current) => current.filter((prompt) => prompt.id !== id));
    setPendingDelete(null);
    setNotice("Prompt removed.");
    setError(null);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setPrompts([]);
    setStatus("signed-out");
  }

  return (
    <div className="min-h-screen px-5 pb-10 pt-5 sm:px-8">
      <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-border pb-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the game
        </Link>
        {status === "ready" && (
          <Button type="button" variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        )}
      </header>

      <main className="mx-auto max-w-5xl py-8 sm:py-12">
        {status === "loading" ? (
          <div className="py-16 text-center text-muted-foreground">Checking access…</div>
        ) : status === "signed-out" ? (
          <section className="mx-auto flex max-w-md flex-col items-center gap-5 py-14 text-center">
            <div className="grid size-14 place-items-center rounded-md bg-secondary text-secondary-foreground">
              <ShieldCheck className="size-7" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase text-muted-foreground">Private area</p>
              <h1 className="mt-2 font-display text-4xl">Game controls</h1>
              <p className="mt-3 text-muted-foreground">Sign in with the approved Google account to continue.</p>
            </div>
            <Button type="button" variant="outline" onClick={handleGoogleSignIn} disabled={busy} className="min-h-11 w-full max-w-xs border-google-border bg-google-background text-google-foreground hover:bg-google-background">
              <GoogleMark />
              {busy ? "Connecting…" : "Continue with Google"}
            </Button>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </section>
        ) : status === "denied" ? (
          <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
            <CircleAlert className="size-8 text-accent" aria-hidden="true" />
            <h1 className="font-display text-4xl">This area is private.</h1>
            <p className="text-muted-foreground">That Google account does not have access to game controls.</p>
            <Link to="/" className="mt-2 text-sm font-semibold text-primary">Return to the game</Link>
          </section>
        ) : status === "error" ? (
          <section className="mx-auto max-w-md py-16 text-center">
            <h1 className="font-display text-4xl">Controls unavailable</h1>
            <p role="alert" className="mt-3 text-muted-foreground">{error ?? "Try refreshing this page."}</p>
            <Button type="button" className="mt-5" onClick={() => window.location.reload()}>Try again</Button>
          </section>
        ) : (
          <>
            <div className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-border pb-6">
              <div>
                <p className="text-sm font-semibold uppercase text-muted-foreground">Truth or Dare / Owner</p>
                <h1 className="mt-2 font-display text-5xl">Prompt library</h1>
                <p className="mt-3 text-muted-foreground">Manage what the bot deals in every room.</p>
              </div>
              {profile && (
                <div className="flex items-center gap-3">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="" className="size-11 rounded-full border border-border object-cover" />
                  ) : (
                    <div className="grid size-11 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
                      {profile.display_name.slice(0, 1).toUpperCase() || "A"}
                    </div>
                  )}
                  <span className="max-w-48 truncate text-sm font-medium">{profile.display_name}</span>
                </div>
              )}
            </div>

            <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
              <section className="flex flex-col gap-5">
                <div>
                  <p className="text-sm font-semibold uppercase text-muted-foreground">Your profile</p>
                  <h2 className="mt-2 font-display text-3xl">Admin details</h2>
                </div>
                <form onSubmit={handleProfileSave} className="grid gap-4 border-b border-border pb-7">
                  <label htmlFor="display-name" className="grid gap-2 text-sm font-medium">
                    Display name
                    <Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} required />
                  </label>
                  <Button type="submit" variant="outline" disabled={busy || !displayName.trim()}>
                    <Check aria-hidden="true" /> Save profile
                  </Button>
                </form>

                <form onSubmit={handleAddPrompt} className="grid gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase text-muted-foreground">New prompt</p>
                    <h2 className="mt-2 font-display text-3xl">Add to the deck</h2>
                  </div>
                  <div className="flex gap-2" role="group" aria-label="Prompt type">
                    <Button type="button" variant={newKind === "truth" ? "default" : "outline"} onClick={() => setNewKind("truth")}>
                      Truth
                    </Button>
                    <Button type="button" variant={newKind === "dare" ? "default" : "outline"} onClick={() => setNewKind("dare")}>
                      Dare
                    </Button>
                  </div>
                  <label htmlFor="prompt-text" className="grid gap-2 text-sm font-medium">
                    Prompt text
                    <textarea
                      id="prompt-text"
                      value={newPrompt}
                      onChange={(event) => setNewPrompt(event.target.value)}
                      minLength={4}
                      maxLength={240}
                      required
                      rows={4}
                      className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder={newKind === "truth" ? "What is something you have always wanted to learn?" : "Give everyone a cheerful compliment."}
                    />
                  </label>
                  <Button type="submit" disabled={busy || newPrompt.trim().length < 4} className="w-fit">
                    <Plus aria-hidden="true" /> Add prompt
                  </Button>
                </form>
              </section>

              <section className="min-w-0">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
                  <div>
                    <p className="text-sm font-semibold uppercase text-muted-foreground">The deck</p>
                    <h2 className="mt-2 font-display text-3xl">Ready for a turn</h2>
                  </div>
                  <div className="flex gap-2" role="group" aria-label="Filter prompt list">
                    <Button type="button" size="sm" variant={activeKind === "truth" ? "secondary" : "ghost"} onClick={() => setActiveKind("truth")}>
                      Truth · {prompts.filter((prompt) => prompt.kind === "truth").length}
                    </Button>
                    <Button type="button" size="sm" variant={activeKind === "dare" ? "secondary" : "ghost"} onClick={() => setActiveKind("dare")}>
                      Dare · {prompts.filter((prompt) => prompt.kind === "dare").length}
                    </Button>
                  </div>
                </div>

                {shownPrompts.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {shownPrompts.map((prompt) => (
                      <li key={prompt.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                        <div className="min-w-0 flex-1">
                          <p className={`mb-1 text-xs font-bold uppercase ${prompt.kind === "truth" ? "text-primary" : "text-accent"}`}>
                            {prompt.active ? "In rotation" : "Paused"}
                          </p>
                          <p className="leading-6">{prompt.prompt}</p>
                          {pendingDelete === prompt.id && (
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                              <span>Remove this prompt?</span>
                              <Button type="button" variant="destructive" size="sm" onClick={() => void handleDeletePrompt(prompt.id)}>
                                Remove
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>
                                Keep
                              </Button>
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={() => void handleTogglePrompt(prompt)}>
                            {prompt.active ? "Pause" : "Restore"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setPendingDelete(prompt.id)}
                            aria-label={`Remove prompt: ${prompt.prompt}`}
                            title="Remove prompt"
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-8 text-sm text-muted-foreground">No prompts in this part of the deck yet.</p>
                )}
              </section>
            </div>

            {(error || notice) && (
              <p role={error ? "alert" : "status"} className={`mt-6 rounded-md p-3 text-sm ${error ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}>
                {error ?? notice}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}