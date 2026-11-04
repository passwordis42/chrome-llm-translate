/** 扩展自己记住的三条快捷键。展示和改键以这里为准，不读 chrome.commands。 */

export const SHORTCUT_IDS = ["page", "crop", "selection"] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  page: "整页开始/继续",
  crop: "截图识译",
  selection: "划词翻译开/关",
};

export interface ManagedShortcuts {
  page: string;
  crop: string;
  selection: string;
}

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

export interface KeySnapshot {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

export const DEFAULT_SHORTCUTS: ManagedShortcuts = {
  page: "Alt+T",
  crop: "Alt+S",
  selection: "Alt+E",
};

const NAMED_KEYS = [
  "Enter",
  "Tab",
  "Space",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
] as const;

const PUNCTUATION: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

const ALLOWED_KEYS = new Set<string>([
  ...NAMED_KEYS,
  ...Object.values(PUNCTUATION),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `Numpad${index}`),
]);

export function defaultShortcuts(): ManagedShortcuts {
  return { ...DEFAULT_SHORTCUTS };
}

export function formatChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  if (chord.meta) parts.push("Cmd");
  parts.push(chord.key);
  return parts.join("+");
}

export function parseChord(raw: string): Chord | null {
  const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  const keys: string[] = [];
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === "CTRL" || upper === "CONTROL") ctrl = true;
    else if (upper === "ALT" || upper === "OPTION") alt = true;
    else if (upper === "SHIFT") shift = true;
    else if (upper === "CMD" || upper === "META" || upper === "COMMAND" || upper === "WIN") meta = true;
    else keys.push(normalizeKeyToken(part));
  }
  if (keys.length !== 1) return null;
  const key = keys[0];
  if (!key || !ALLOWED_KEYS.has(key)) return null;
  if (!ctrl && !alt && !meta) return null;
  return { ctrl, alt, shift, meta, key };
}

export function chordFromKey(event: KeySnapshot): Chord | null {
  if (event.repeat) return null;
  if (isModifier(event)) return null;
  const key = tokenFromEvent(event);
  if (!key || !ALLOWED_KEYS.has(key)) return null;
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key,
  };
}

export function matchShortcut(event: KeySnapshot, shortcuts: ManagedShortcuts): ShortcutId | null {
  const chord = chordFromKey(event);
  if (!chord) return null;
  const formatted = formatChord(chord);
  for (const id of SHORTCUT_IDS) {
    if (shortcuts[id] === formatted) return id;
  }
  return null;
}

export interface AssignOk {
  ok: true;
  shortcuts: ManagedShortcuts;
}

export interface AssignConflict {
  ok: false;
  message: string;
  shortcuts: ManagedShortcuts;
}

/** 与另一条相同则拒绝，原组合键保持不动。 */
export function assignShortcut(shortcuts: ManagedShortcuts, id: ShortcutId, raw: string): AssignOk | AssignConflict {
  const parsed = parseChord(raw);
  if (!parsed) {
    return {
      ok: false,
      message: "请按下修饰键和主键，例如 Alt+T。当前键没有改。",
      shortcuts,
    };
  }
  const formatted = formatChord(parsed);
  for (const other of SHORTCUT_IDS) {
    if (other === id) continue;
    if (shortcuts[other] === formatted) {
      return {
        ok: false,
        message: `这个组合键已经用于「${SHORTCUT_LABELS[other]}」。没有改掉当前键。`,
        shortcuts,
      };
    }
  }
  return { ok: true, shortcuts: { ...shortcuts, [id]: formatted } };
}

export function restoreDefaultShortcuts(): ManagedShortcuts {
  return defaultShortcuts();
}

/**
 * 缺槽、写坏、或和前面的槽撞车时，用还没被占用的默认键补上。
 * 三条默认互不冲突；补完后仍然互不相同。
 */
export function normalizeShortcuts(raw: unknown): ManagedShortcuts {
  const defaults = defaultShortcuts();
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next: ManagedShortcuts = { ...defaults };
  const used = new Set<string>();
  for (const id of SHORTCUT_IDS) {
    const parsed = typeof record[id] === "string" ? parseChord(record[id]) : null;
    const formatted = parsed ? formatChord(parsed) : null;
    if (formatted && !used.has(formatted)) {
      next[id] = formatted;
      used.add(formatted);
      continue;
    }
    const free = SHORTCUT_IDS.map((slot) => defaults[slot]).find((value) => !used.has(value)) ?? defaults[id];
    next[id] = free;
    used.add(free);
  }
  return next;
}

export function shortcutsStorageMatches(raw: unknown, normalized: ManagedShortcuts): boolean {
  if (!raw || typeof raw !== "object") return false;
  const record = raw as Record<string, unknown>;
  return SHORTCUT_IDS.every((id) => record[id] === normalized[id]);
}

export function formatHotkeyTip(shortcuts: ManagedShortcuts): string {
  return `${shortcuts.page} 整页 · ${shortcuts.crop} 识译 · ${shortcuts.selection} 划词 · 右键 ⌝/⌟/⌞`;
}

export function createShortcutGate(windowMs = 350): (action: ShortcutId, now?: number) => boolean {
  let last: { action: ShortcutId; at: number } | null = null;
  return (action, now = Date.now()) => {
    if (last && last.action === action && now - last.at < windowMs) return false;
    last = { action, at: now };
    return true;
  };
}

function normalizeKeyToken(part: string): string {
  if (/^[a-z]$/i.test(part)) return part.toUpperCase();
  if (/^f([1-9]|1[0-2])$/i.test(part)) return part.toUpperCase();
  const aliases: Record<string, string> = {
    space: "Space",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };
  const lowered = part.toLowerCase();
  if (aliases[lowered]) return aliases[lowered];
  if (/^numpad[0-9]$/i.test(part)) return `Numpad${part.slice(-1)}`;
  return part;
}

function tokenFromEvent(event: KeySnapshot): string | null {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code;
  if (/^F([1-9]|1[0-2])$/.test(event.code)) return event.code;
  if (PUNCTUATION[event.code]) return PUNCTUATION[event.code];
  if ((NAMED_KEYS as readonly string[]).includes(event.code)) return event.code;
  if (event.code === "NumpadEnter") return "Enter";
  if (event.key.length === 1 && /[a-z0-9]/i.test(event.key)) return event.key.toUpperCase();
  return null;
}

function isModifier(event: KeySnapshot): boolean {
  return /^(Alt|Control|Shift|Meta|OS)(Left|Right)?$/.test(event.key)
    || /^(Alt|Control|Shift|Meta|OS)(Left|Right)$/.test(event.code);
}
