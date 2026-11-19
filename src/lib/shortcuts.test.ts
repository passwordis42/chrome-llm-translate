import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { commandToPageMessage } from "./commands.ts";
import { normalizeSettings, shouldRewriteSettings } from "./settings.ts";
import {
  assignShortcut,
  chordFromKey,
  createShortcutGate,
  defaultShortcuts,
  formatChord,
  formatHotkeyTip,
  formatPageHotkeyNote,
  matchShortcut,
  normalizeShortcuts,
  parseChord,
  restoreDefaultShortcuts,
  type KeySnapshot,
} from "./shortcuts.ts";

function key(partial: Partial<KeySnapshot> & Pick<KeySnapshot, "key" | "code">): KeySnapshot {
  return {
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    ...partial,
  };
}

describe("managed shortcuts", () => {
  it("defaults to Alt+T, Alt+S and Alt+E and prints them on the tip", () => {
    const shortcuts = defaultShortcuts();
    assert.deepEqual(shortcuts, {
      page: "Alt+T",
      crop: "Alt+S",
      selection: "Alt+E",
      swap: "Alt+Shift+Y",
      input: "Alt+Shift+I",
    });
    assert.equal(formatHotkeyTip(shortcuts), "Alt+T 整页 · Alt+S 识译 · Alt+E 划词 · 右键 ⌝/⌟/⌞");
    assert.equal(formatHotkeyTip(shortcuts).includes("未设置"), false);
    assert.equal(normalizeSettings({}).shortcuts.page, "Alt+T");
    assert.equal(normalizeSettings({ selectionEnabled: false }).shortcuts.selection, "Alt+E");
    assert.equal(normalizeSettings({ selectionEnabled: false }).selectionEnabled, false);
  });

  it("matches a physical Alt+T even when Option rewrites event.key", () => {
    const mac = key({ key: "†", code: "KeyT", altKey: true });
    assert.equal(formatChord(chordFromKey(mac)!), "Alt+T");
    assert.equal(matchShortcut(mac, defaultShortcuts()), "page");
    assert.equal(matchShortcut(key({ key: "s", code: "KeyS", altKey: true }), defaultShortcuts()), "crop");
    assert.equal(matchShortcut(key({ key: "e", code: "KeyE", altKey: true }), defaultShortcuts()), "selection");
    assert.equal(matchShortcut(key({ key: "t", code: "KeyT" }), defaultShortcuts()), null);
    assert.equal(matchShortcut(key({ key: "T", code: "KeyT", shiftKey: true }), defaultShortcuts()), null);
    assert.equal(chordFromKey(key({ key: "Alt", code: "AltLeft", altKey: true })), null);
  });

  it("canonicalizes modifier order and rejects a chord that collides", () => {
    const parsed = parseChord("shift+alt+k");
    assert.ok(parsed);
    assert.equal(formatChord(parsed), "Alt+Shift+K");
    const moved = assignShortcut(defaultShortcuts(), "page", "Ctrl+Shift+Y");
    assert.equal(moved.ok, true);
    if (moved.ok) assert.equal(moved.shortcuts.page, "Ctrl+Shift+Y");

    const clash = assignShortcut(defaultShortcuts(), "crop", "Alt+T");
    assert.equal(clash.ok, false);
    if (!clash.ok) {
      assert.match(clash.message, /整页开始\/继续/);
      assert.match(clash.message, /没有改掉当前键/);
      assert.equal(clash.shortcuts.crop, "Alt+S");
      assert.equal(clash.shortcuts.page, "Alt+T");
    }
    assert.equal(parseChord("Shift+T"), null);
    assert.equal(parseChord("T"), null);
    assert.deepEqual(restoreDefaultShortcuts(), defaultShortcuts());
  });

  it("fills missing slots on upgrade and keeps a custom chord", () => {
    const legacy = {
      apiKey: "sk-test",
      model: "qwen-plus",
      selectionEnabled: true,
      gestureEnabled: true,
      glossary: [],
    };
    assert.equal(shouldRewriteSettings(legacy), true);
    const seeded = normalizeSettings(legacy);
    assert.equal(seeded.apiKey, "sk-test");
    assert.equal(seeded.model, "qwen-plus");
    assert.deepEqual(seeded.shortcuts, defaultShortcuts());
    assert.equal(shouldRewriteSettings(seeded), false);
    const upgraded: Record<string, unknown> = { ...seeded };
    delete upgraded.shortcuts;
    assert.equal(shouldRewriteSettings(upgraded), true);

    const custom = normalizeSettings({
      shortcuts: { page: "Ctrl+Shift+Y", crop: "Alt+S", selection: "alt+e" },
    });
    assert.equal(custom.shortcuts.page, "Ctrl+Shift+Y");
    assert.equal(custom.shortcuts.selection, "Alt+E");
    assert.equal(shouldRewriteSettings(custom), false);

    const repaired = normalizeShortcuts({ page: "Alt+S", crop: "Alt+S", selection: "Alt+E" });
    assert.equal(repaired.page, "Alt+S");
    assert.equal(repaired.crop, "Alt+T");
    assert.equal(repaired.selection, "Alt+E");
    assert.equal(repaired.swap, "Alt+Shift+Y");
    assert.equal(repaired.input, "Alt+Shift+I");
    assert.equal(new Set(Object.values(repaired)).size, 5);
  });

  it("M19 collapses the old three command and page listeners inside 350ms", () => {
    const gate = createShortcutGate(350);
    assert.equal(gate("selection", 1_000), true);
    assert.equal(gate("selection", 1_200), false);
    assert.equal(gate("page", 1_200), true);
    assert.equal(gate("crop", 1_200), true);
    assert.equal(gate("crop", 1_400), false);
    assert.equal(gate("selection", 1_400), true);
    assert.equal(commandToPageMessage("selection").type, "toggle-selection");
    assert.equal(commandToPageMessage("page").type, "page-ai-start");
    assert.equal(commandToPageMessage("crop").type, "start-crop-ocr");
  });

  it("M20 keeps new webpage shortcuts off commands and rejects collisions with the old three", () => {
    const defaults = defaultShortcuts();
    const blocked = assignShortcut(defaults, "swap", "Alt+T");
    assert.equal(blocked.ok, false);
    assert.equal(blocked.shortcuts.swap, "Alt+Shift+Y");
    assert.equal(blocked.shortcuts.page, "Alt+T");
    const blockedInput = assignShortcut(defaults, "input", "Alt+E");
    assert.equal(blockedInput.ok, false);
    assert.equal(blockedInput.shortcuts.input, "Alt+Shift+I");
    assert.equal(blockedInput.shortcuts.selection, "Alt+E");
    assert.equal(matchShortcut(key({ key: "Y", code: "KeyY", altKey: true, shiftKey: true }), defaults), "swap");
    assert.equal(matchShortcut(key({ key: "I", code: "KeyI", altKey: true, shiftKey: true }), defaults), "input");
    const gate = createShortcutGate(350);
    assert.equal(gate("swap", 2_000), true);
    assert.equal(gate("swap", 2_100), false);
    assert.equal(gate("input", 2_100), true);
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      commands: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(manifest.commands).sort(), ["start-crop-ocr", "start-page-translate", "toggle-selection"]);
    const background = readFileSync(new URL("../background/index.ts", import.meta.url), "utf8");
    assert.equal(background.includes("swap-direction"), false);
    assert.equal(background.includes("open-input-translate"), false);
  });

  it("names the saved webpage keys and does not call an unverified chord available", () => {
    const custom = { ...defaultShortcuts(), swap: "Ctrl+Shift+Y" };
    const note = formatPageHotkeyNote(custom);
    assert.match(note, /Ctrl\+Shift\+Y/);
    assert.match(note, /Alt\+Shift\+I/);
    assert.match(note, /尚未验证/);
    assert.match(note, /请用按钮/);
    assert.equal(note.includes("未绑定"), false);
    assert.equal(note.includes("已可用"), false);
    const popup = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const settings = popup.slice(popup.indexOf('id="settings-view"'), popup.indexOf('id="glossary-view"'));
    assert.match(settings, /冲突尚未验证，请先用按钮/);
    assert.equal(settings.includes("未绑定"), false);
  });

  it("keeps rebinding in settings and the live keys on the home tip", () => {
    const popup = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const main = readFileSync(new URL("../popup/main.ts", import.meta.url), "utf8");
    const home = popup.slice(popup.indexOf('id="home-view"'), popup.indexOf('id="settings-view"'));
    const settings = popup.slice(popup.indexOf('id="settings-view"'), popup.indexOf('id="glossary-view"'));
    assert.match(home, /Alt\+T/);
    assert.match(home, /Alt\+E/);
    assert.match(home, /⌞/);
    assert.equal(home.includes("改键"), false);
    assert.equal(home.includes("恢复默认"), false);
    assert.match(settings, /整页开始\/继续/);
    assert.match(settings, /截图识译/);
    assert.match(settings, /划词翻译开\/关/);
    assert.match(settings, /改键/);
    assert.match(settings, /恢复默认/);
    assert.match(settings, /以扩展内设置为准/);
    assert.match(main, /按下新组合键…（Esc 取消）/);
    assert.match(settings, /⌞ 划词开\/关/);
    assert.equal(settings.includes('id="selection-toggle"'), false);
    assert.equal(settings.includes('id="home-selection-toggle"'), false);
    assert.equal(main.includes("chrome.commands.getAll"), false);
    assert.equal(main.includes("未设置"), false);
    assert.match(main, /assignShortcut/);
  });
});
