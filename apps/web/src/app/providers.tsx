"use client";
import { useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import { connectSockets } from "@/lib/socket";
import { useStore } from "@/lib/store";
import { LoginScreen } from "@/components/LoginScreen";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";

const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

export function Providers({ children }: { children: ReactNode }) {
  const authed = useStore((s) => s.authed);
  const setAuthed = useStore((s) => s.setAuthed);

  useEffect(() => {
    if (DEMO) {
      setAuthed(true);
      return;
    }
    let cancelled = false;
    api
      .me()
      .then((r) => !cancelled && setAuthed(r.authed))
      .catch(() => !cancelled && setAuthed(false));
    return () => {
      cancelled = true;
    };
  }, [setAuthed]);

  useEffect(() => {
    if (authed) connectSockets();
  }, [authed]);

  // No service worker: PoolPilot is a live control panel (useless offline), and
  // an offline cache only caused stale-bundle 404s after deploys. We don't
  // register one anymore; any previously-installed SW is auto-updated by the
  // browser to public/sw.js, which purges its caches and unregisters itself.

  if (authed === null) {
    return (
      <div className="relative z-10 grid min-h-dvh place-items-center">
        <div className="h-10 w-10 animate-[spin-slow_1.4s_linear_infinite] rounded-full border-2 border-aqua/30 border-t-aqua" />
      </div>
    );
  }

  if (!authed) {
    return <LoginScreen onAuthed={() => setAuthed(true)} />;
  }

  return (
    <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <TopBar />
      <main className="flex-1 px-4 pb-28 pt-1">{children}</main>
      <BottomNav />
    </div>
  );
}
