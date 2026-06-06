import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  remoteControl,
  runStop,
  setRpm,
  scanFrames,
  Action,
  REG_RPM,
  ADDR_PUMP,
} from "@pool/protocol";
import { Guardian } from "../src/guardian.js";
import type { Upstream } from "../src/guardian.js";

const PUMP = ADDR_PUMP;
const KEEP_ALIVE = 5000;
const MAX = 300_000;

class FakeUpstream implements Upstream {
  connected = true;
  writes: Uint8Array[] = [];
  write(bytes: Uint8Array): void {
    this.writes.push(bytes);
  }
  /** All frames written so far (decoded), addressed to the pump. */
  frames() {
    const all: ReturnType<typeof scanFrames>["frames"] = [];
    for (const w of this.writes) all.push(...scanFrames(w).frames);
    return all;
  }
  clear(): void {
    this.writes = [];
  }
}

/** Concatenate the app's "I want RPM" command burst, as pool-api's engine sends it. */
function appRunBurst(rpm: number): Uint8Array {
  const parts = [remoteControl(true, PUMP), runStop(true, PUMP), setRpm(rpm, PUMP)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function lastSetRpm(up: FakeUpstream): number | null {
  let rpm: number | null = null;
  for (const f of up.frames()) {
    if (
      f.action === Action.SetRegister &&
      f.data[0] === REG_RPM[0] &&
      f.data[1] === REG_RPM[1] &&
      f.data.length >= 4
    ) {
      rpm = ((f.data[2] ?? 0) << 8) | (f.data[3] ?? 0);
    }
  }
  return rpm;
}

describe("Guardian", () => {
  let up: FakeUpstream;
  let g: Guardian;

  beforeEach(() => {
    vi.useFakeTimers();
    up = new FakeUpstream();
    g = new Guardian(up, { pumpAddr: PUMP, keepAliveMs: KEEP_ALIVE, failoverMaxMs: MAX });
  });
  afterEach(() => {
    g.dispose();
    vi.useRealTimers();
  });

  it("relays without writing anything while the app is connected", () => {
    g.setClientConnected(true);
    g.observe(appRunBurst(2400));
    expect(g.state).toBe("relaying");
    expect(up.writes).toHaveLength(0); // the app owns the bus; guardian stays silent
  });

  it("holds the last running setpoint when the app disconnects mid-run", () => {
    g.setClientConnected(true);
    g.observe(appRunBurst(2400));
    g.setClientConnected(false);

    expect(g.state).toBe("holding");
    expect(g.heldRpm).toBe(2400);
    expect(lastSetRpm(up)).toBe(2400); // asserted immediately, no gap

    up.clear();
    vi.advanceTimersByTime(KEEP_ALIVE);
    expect(lastSetRpm(up)).toBe(2400); // and re-asserted every keep-alive
  });

  it("does NOT hold if the app's last word was a release", () => {
    g.setClientConnected(true);
    g.observe(appRunBurst(2400));
    g.observe(remoteControl(false, PUMP)); // app handed control back before leaving
    g.setClientConnected(false);

    expect(g.state).toBe("idle");
    expect(up.writes).toHaveLength(0); // let the pump revert on its own
  });

  it("does NOT hold if the pump was stopped (rpm 0 / stop)", () => {
    g.setClientConnected(true);
    g.observe(remoteControl(true, PUMP));
    g.observe(runStop(false, PUMP));
    g.setClientConnected(false);

    expect(g.state).toBe("idle");
    expect(up.writes).toHaveLength(0);
  });

  it("hands the bus back the instant the app reconnects (and stops writing)", () => {
    g.setClientConnected(true);
    g.observe(appRunBurst(2400));
    g.setClientConnected(false);
    expect(g.state).toBe("holding");

    g.setClientConnected(true); // app process is back
    expect(g.state).toBe("relaying");

    up.clear();
    vi.advanceTimersByTime(KEEP_ALIVE * 3);
    expect(up.writes).toHaveLength(0); // no more keep-alives once the app is back
  });

  it("releases to the onboard schedule after the failover ceiling", () => {
    g.setClientConnected(true);
    g.observe(appRunBurst(2400));
    g.setClientConnected(false);

    vi.advanceTimersByTime(MAX - KEEP_ALIVE); // ride almost to the ceiling
    expect(g.state).toBe("holding");

    up.clear();
    vi.advanceTimersByTime(KEEP_ALIVE * 2); // cross the ceiling
    expect(g.state).toBe("idle");

    const frames = up.frames();
    // the final action should be a remote-control RELEASE, then silence
    const release = frames.find(
      (f) => f.action === Action.RemoteControl && f.data[0] === 0x00,
    );
    expect(release).toBeTruthy();
  });

  it("survives a setpoint frame split across two TCP chunks", () => {
    g.setClientConnected(true);
    const burst = appRunBurst(1800);
    g.observe(burst.slice(0, 7));
    g.observe(burst.slice(7));
    g.setClientConnected(false);
    expect(g.heldRpm).toBe(1800);
  });

  it("does not write keep-alives while the upstream is down", () => {
    up.connected = false;
    g.setClientConnected(true);
    g.observe(appRunBurst(2400));
    g.setClientConnected(false);
    expect(up.writes).toHaveLength(0);
  });
});
