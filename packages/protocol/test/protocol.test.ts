import { describe, it, expect } from "vitest";
import {
  checksum,
  findFrames,
  scanFrames,
  decodeStatus,
  isPumpStatus,
  statusRequest,
  setRpm,
  runStop,
  remoteControl,
  clampRpm,
  ADDR_PUMP,
  ADDR_CONTROLLER,
} from "../src/index.js";

const hex = (u: Uint8Array): string =>
  Array.from(u)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

describe("checksum", () => {
  it("matches the known set-1500-RPM body (0x02D2)", () => {
    const body = [0xa5, 0x00, 0x60, 0x21, 0x01, 0x04, 0x02, 0xc4, 0x05, 0xdc];
    expect(checksum(body)).toEqual([0x02, 0xd2]);
  });
});

describe("setRpm / clampRpm", () => {
  it("produces the exact captured 1500-RPM frame", () => {
    expect(hex(setRpm(1500))).toBe("ff 00 ff a5 00 60 21 01 04 02 c4 05 dc 02 d2");
  });
  it("produces the exact captured 2500-RPM frame", () => {
    expect(hex(setRpm(2500))).toBe("ff 00 ff a5 00 60 21 01 04 02 c4 09 c4 02 be");
  });
  it("clamps out-of-range RPM to 0..3450", () => {
    expect(clampRpm(99999)).toBe(3450);
    expect(clampRpm(-5)).toBe(0);
    expect(hex(setRpm(99999))).toBe("ff 00 ff a5 00 60 21 01 04 02 c4 0d 7a 02 78");
  });
});

describe("command factories", () => {
  it("statusRequest", () => {
    expect(hex(statusRequest())).toBe("ff 00 ff a5 00 60 21 07 00 01 2d");
  });
  it("remoteControl enable matches the validated frame", () => {
    expect(hex(remoteControl(true))).toBe("ff 00 ff a5 00 60 21 04 01 ff 02 2a");
  });
  it("remoteControl release", () => {
    expect(hex(remoteControl(false))).toBe("ff 00 ff a5 00 60 21 04 01 00 01 2b");
  });
  it("runStop run / stop", () => {
    expect(hex(runStop(true))).toBe("ff 00 ff a5 00 60 21 06 01 0a 01 37");
    expect(hex(runStop(false))).toBe("ff 00 ff a5 00 60 21 06 01 04 01 31");
  });
});

describe("findFrames + decodeStatus", () => {
  // Real status reply captured from the pump (with FF 00 FF preamble + 0x02E0 checksum).
  const reply = Uint8Array.from([
    0xff, 0x00, 0xff, 0xa5, 0x00, 0x21, 0x60, 0x07, 0x0f, 0x0a, 0x00, 0x02, 0x00, 0x87, 0x05,
    0xdc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x11, 0x1f, 0x02, 0xe0,
  ]);

  it("parses one frame from the pump", () => {
    const frames = findFrames(reply);
    expect(frames).toHaveLength(1);
    const f = frames[0]!;
    expect(f.src).toBe(ADDR_PUMP);
    expect(f.dst).toBe(ADDR_CONTROLLER);
    expect(f.action).toBe(0x07);
    expect(isPumpStatus(f, ADDR_PUMP)).toBe(true);
    expect(f.data).toHaveLength(15);
  });

  it("decodes 135 W / 1500 RPM / drive running / clock 17:31", () => {
    const s = decodeStatus(findFrames(reply)[0]!.data);
    expect(s.watts).toBe(135);
    expect(s.rpm).toBe(1500);
    expect(s.running).toBe(true);
    expect(s.command).toBe(0x0a);
    expect(s.driveState).toBe(2);
    expect(s.flow).toBe(0);
    expect(s.ppc).toBe(0);
    expect(s.statusWord).toBe(0);
    expect(s.statusText).toBe("Ok");
    expect(s.clockHH).toBe(17);
    expect(s.clockMM).toBe(31);
    expect(s.clockMinutes).toBe(17 * 60 + 31);
  });

  it("extracts frames even with leading/trailing noise on the bus", () => {
    const noisy = Uint8Array.from([0x12, 0x34, ...reply, 0xff, 0x00]);
    const frames = findFrames(noisy);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const pump = frames.find((f) => f.src === ADDR_PUMP);
    expect(pump).toBeDefined();
    expect(decodeStatus(pump!.data).rpm).toBe(1500);
  });

  it("verifyChecksum keeps a valid frame but drops a corrupted one", () => {
    // valid frame passes through unchanged
    expect(scanFrames(reply, { verifyChecksum: true }).frames).toHaveLength(1);

    // flip a data byte so the trailing checksum no longer matches → dropped
    const corrupt = Uint8Array.from(reply);
    corrupt[13] = (corrupt[13]! + 1) & 0xff; // the clock-HH byte (would misdecode the time)
    const { frames } = scanFrames(corrupt, { verifyChecksum: true });
    expect(frames).toHaveLength(0);

    // without verification, the corrupted frame still decodes (old lenient behavior)
    expect(scanFrames(corrupt).frames).toHaveLength(1);
  });

  it("scanFrames retains a trailing partial frame (TCP fragmentation)", () => {
    // full reply followed by the first 4 bytes of a second, incomplete frame
    const partial = Uint8Array.from([...reply, 0xff, 0x00, 0xff, 0xa5]);
    const { frames, consumed } = scanFrames(partial);
    expect(frames).toHaveLength(1);
    // the 0xa5 of the partial frame must be retained, not consumed
    const remainder = partial.slice(consumed);
    expect(Array.from(remainder)).toContain(0xa5);
    expect(remainder[remainder.length - 1]).toBe(0xa5);
  });
});
