/**
 * One-time calibration: measure how long the SuperFlo VST takes to revert to its
 * onboard schedule after RS-485 commands stop. Run with njsPC STOPPED so we own
 * the bus. Result feeds KEEP_ALIVE_MS = min(revert) / 3.
 *
 *   pnpm --filter @pool/api calibrate
 */
import { BridgeConnection } from "../bridge/connection.js";
import { remoteControl, setRpm, statusRequest } from "@pool/protocol";
import { config } from "../config.js";

const TARGET = 2400;
const ROUNDS = 3;
const DRIVE_MS = 12_000;
const MAX_WAIT_MS = 90_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const bridge = new BridgeConnection(config.BRIDGE_HOST, config.BRIDGE_PORT, config.PUMP_ADDRESS);
  let lastRpm = 0;
  bridge.onStatus((s) => {
    lastRpm = s.rpm;
  });
  bridge.start();

  for (let i = 0; i < 20 && !bridge.connected; i++) await sleep(250);
  if (!bridge.connected) {
    console.error(`could not connect to bridge ${config.BRIDGE_HOST}:${config.BRIDGE_PORT}`);
    process.exit(1);
  }
  console.log("connected. (Make sure njsPC is stopped so nothing else drives the bus.)\n");

  const results: number[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`=== round ${round}/${ROUNDS}: commanding ${TARGET} RPM for ${DRIVE_MS / 1000}s ===`);
    const driveUntil = Date.now() + DRIVE_MS;
    while (Date.now() < driveUntil) {
      await bridge.write(remoteControl(true, config.PUMP_ADDRESS)).catch(() => {});
      await sleep(100);
      await bridge.write(setRpm(TARGET, config.PUMP_ADDRESS)).catch(() => {});
      await sleep(100);
      await bridge.write(statusRequest(config.PUMP_ADDRESS)).catch(() => {});
      await sleep(800);
    }
    if (Math.abs(lastRpm - TARGET) > 150) {
      console.log(`  pump not at target (rpm=${lastRpm}); skipping round\n`);
      continue;
    }
    console.log(`  at target (rpm=${lastRpm}). Stopping commands, polling only…`);
    const stoppedAt = Date.now();
    let revertMs: number | null = null;
    while (Date.now() - stoppedAt < MAX_WAIT_MS) {
      await bridge.write(statusRequest(config.PUMP_ADDRESS)).catch(() => {});
      await sleep(1000);
      if (Math.abs(lastRpm - TARGET) > 200) {
        revertMs = Date.now() - stoppedAt;
        break;
      }
    }
    if (revertMs !== null) {
      console.log(`  >>> reverted after ${(revertMs / 1000).toFixed(1)}s (rpm now ${lastRpm})\n`);
      results.push(revertMs);
    } else {
      console.log(`  no revert within ${MAX_WAIT_MS / 1000}s (rpm still ${lastRpm})\n`);
    }
    await sleep(3000);
  }

  bridge.close();
  if (results.length > 0) {
    const min = Math.min(...results);
    console.log(`revert times: ${results.map((r) => (r / 1000).toFixed(1) + "s").join(", ")}`);
    console.log(
      `MIN revert = ${(min / 1000).toFixed(1)}s  →  set KEEP_ALIVE_MS = ${Math.floor(min / 3)} (min / 3)`,
    );
  } else {
    console.log("no revert measurements collected.");
  }
  process.exit(0);
}

void main();
