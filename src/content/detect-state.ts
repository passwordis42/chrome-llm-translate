import { createDetectionBook, type Direction } from "../lib/direction.ts";
import type { Settings } from "../lib/settings.ts";

export const detectionBook = createDetectionBook();

export function directionOf(settings: Pick<Settings, "sourceLang" | "targetLang">): Direction {
  return { sourceLang: settings.sourceLang, targetLang: settings.targetLang };
}

let readLiveDirection: (() => Direction | null) | null = null;

export function bindDirectionReader(read: () => Direction | null): void {
  readLiveDirection = read;
}

export function liveDirection(): Direction | null {
  return readLiveDirection ? readLiveDirection() : null;
}

export function rememberDetection(
  text: string,
  direction: Direction,
  token: number,
  detection: string,
  code: string,
): void {
  if (detection === "code" || detection === "unknown") {
    detectionBook.commit(token, text, direction, detection === "code" ? code : null, detection === "unknown");
    return;
  }
  detectionBook.drop(token);
}
