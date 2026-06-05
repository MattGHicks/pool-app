type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: Level = process.env.NODE_ENV === "production" ? "info" : "debug";

function emit(level: Level, objOrMsg: unknown, maybeMsg?: string): void {
  if (order[level] < order[minLevel]) return;
  const time = new Date().toISOString();
  const tag = `${time} ${level.toUpperCase().padEnd(5)}`;
  const sink = level === "debug" ? console.log : console[level];
  if (typeof objOrMsg === "string") sink(`${tag} ${objOrMsg}`);
  else sink(`${tag} ${maybeMsg ?? ""}`, objOrMsg);
}

export const logger = {
  debug: (o: unknown, m?: string): void => emit("debug", o, m),
  info: (o: unknown, m?: string): void => emit("info", o, m),
  warn: (o: unknown, m?: string): void => emit("warn", o, m),
  error: (o: unknown, m?: string): void => emit("error", o, m),
};
