import { ImageResponse } from "next/og";

// Branded share card used for og:image / twitter:image. Generated at build time
// so there's no binary asset to maintain — the look mirrors the in-app theme
// (dark navy, aqua wave mark) defined in globals.css.
export const alt = "PoolPilot — pool pump control & energy monitoring";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#05090e",
          backgroundImage:
            "radial-gradient(125% 80% at 50% -10%, rgba(52,227,212,0.18), transparent 58%), radial-gradient(90% 60% at 112% 6%, rgba(255,180,84,0.10), transparent 55%), radial-gradient(80% 60% at -12% 112%, rgba(139,123,255,0.10), transparent 55%)",
          color: "#e9f5f4",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 184,
            height: 184,
            borderRadius: 46,
            background: "linear-gradient(160deg, #0c2230, #05090e)",
            border: "1px solid #1c2f3f",
            boxShadow: "0 0 90px -8px rgba(52,227,212,0.5)",
          }}
        >
          <svg
            width="120"
            height="120"
            viewBox="0 0 512 512"
            fill="none"
            stroke="#34e3d4"
            strokeWidth={26}
            strokeLinecap="round"
          >
            <path d="M96 196c40 0 40-34 80-34s40 34 80 34 40-34 80-34 40 34 80 34" />
            <path d="M96 296c40 0 40-34 80-34s40 34 80 34 40-34 80-34 40 34 80 34" />
          </svg>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 46,
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: -2,
          }}
        >
          PoolPilot
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 14,
            fontSize: 34,
            color: "#88a0ad",
          }}
        >
          Pool pump control &amp; energy monitoring
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 44 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              background: "#34e3d4",
              boxShadow: "0 0 16px #34e3d4",
            }}
          />
          <div
            style={{
              display: "flex",
              fontSize: 24,
              letterSpacing: 5,
              textTransform: "uppercase",
              color: "#4f6173",
            }}
          >
            Live telemetry
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
