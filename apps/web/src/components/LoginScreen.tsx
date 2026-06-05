"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { IconWaves } from "./icons";

export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.login(pw, remember);
      onAuthed();
    } catch {
      setErr("Incorrect password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-aqua/10 text-aqua"
            style={{ boxShadow: "0 0 34px -6px var(--color-aqua)" }}
          >
            <IconWaves width={28} height={28} />
          </div>
          <h1 className="font-display text-2xl tracking-wide">PoolPilot</h1>
          <p className="mt-1 text-sm text-text-dim">Enter your password to take control.</p>
        </div>
        <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-5">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full rounded-xl border border-border bg-bg/60 px-4 py-3 text-text outline-none transition focus:border-aqua/60"
          />
          <label className="flex items-center gap-2 text-sm text-text-dim">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="accent-aqua"
            />
            Keep me signed in
          </label>
          {err ? <div className="text-sm text-coral">{err}</div> : null}
          <button
            type="submit"
            disabled={busy || !pw}
            className="w-full rounded-xl bg-aqua py-3 font-medium text-bg transition disabled:opacity-40"
            style={{ boxShadow: "0 0 24px -6px var(--color-aqua)" }}
          >
            {busy ? "…" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
