"use client";
import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { SettingsDTO } from "@pool/types";
import { IconLogout, IconShield } from "@/components/icons";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5 text-sm">
      <span className="text-text-dim">{label}</span>
      <span className="font-mono text-text">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const health = useStore((s) => s.health);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => {});
  }, []);

  const logout = async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  return (
    <div className="space-y-4 pt-2">
      <SectionTitle>Failsafe</SectionTitle>
      <Card className="flex items-start gap-3 p-4">
        <div className="mt-0.5 text-aqua">
          <IconShield width={18} height={18} />
        </div>
        <div className="text-[0.78rem] leading-relaxed text-text-dim">
          PoolPilot only ever <span className="text-text">overrides</span> the pump. The pump&apos;s onboard
          keypad schedule stays the safe baseline — if the app, bridge, or server stops, the pump reverts to
          that schedule on its own. The physical Start/Stop button always wins.
        </div>
      </Card>

      <SectionTitle>System</SectionTitle>
      <Card className="divide-y divide-border">
        <Row label="Poll interval" value={settings ? `${settings.pollMs} ms` : "—"} />
        <Row label="Keep-alive" value={settings ? `${settings.keepAliveMs} ms` : "—"} />
        <Row
          label="Revert window"
          value={settings?.revertTimeoutMs ? `${settings.revertTimeoutMs} ms` : "uncalibrated"}
        />
        <Row label="Baseline" value={settings ? `${settings.baselineRpm} rpm` : "—"} />
        <Row label="Bridge" value={health?.busConnected ? "connected" : "offline"} />
      </Card>

      <SectionTitle>Pool</SectionTitle>
      <Card className="divide-y divide-border">
        <Row label="Volume" value={settings ? `${settings.poolGallons.toLocaleString()} gal` : "8,500 gal"} />
        <Row label="Rate" value={settings ? `$${settings.ratePerKwh}/kWh` : "$0.205/kWh"} />
        <Row
          label="Pump WEF"
          value={settings ? `${settings.wefGalPerKwh.toLocaleString()} gal/kWh` : "9,000 gal/kWh"}
        />
      </Card>

      <button
        onClick={() => void logout()}
        className="glass flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm text-text-dim transition active:text-text"
      >
        <IconLogout width={18} height={18} /> Sign out
      </button>
      <div className="pt-1 text-center text-[0.6rem] text-text-faint">
        PoolPilot · Pentair SuperFlo VST
      </div>
    </div>
  );
}
