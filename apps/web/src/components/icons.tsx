import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Svg(props: P) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export const IconGauge = (p: P) => (
  <Svg {...p}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 14l3.5-3" />
    <circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Svg>
);

export const IconBolt = (p: P) => (
  <Svg {...p}>
    <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z" />
  </Svg>
);

export const IconSliders = (p: P) => (
  <Svg {...p}>
    <path d="M5 21v-7M5 10V3M12 21v-9M12 8V3M19 21v-5M19 12V3" />
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="19" cy="14" r="2" />
  </Svg>
);

export const IconPower = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v9" />
    <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
  </Svg>
);

export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M7 5l12 7-12 7z" fill="currentColor" />
  </Svg>
);

export const IconWaves = (p: P) => (
  <Svg {...p}>
    <path d="M2 8c2 0 2-1.6 4-1.6S8 8 10 8s2-1.6 4-1.6S16 8 18 8s2-1.6 4-1.6" />
    <path d="M2 13c2 0 2-1.6 4-1.6S8 13 10 13s2-1.6 4-1.6S16 13 18 13s2-1.6 4-1.6" />
    <path d="M2 18c2 0 2-1.6 4-1.6S8 18 10 18s2-1.6 4-1.6S16 18 18 18s2-1.6 4-1.6" />
  </Svg>
);

export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2" />
    <path d="M18 12H9M15 9l3 3-3 3" />
  </Svg>
);
