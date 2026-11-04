export const PORT_NAME = "yifan-translate";

export interface StartMessage {
  type: "start";
  text: string;
  sourceLang?: string;
  targetLang?: string;
}

export type PortOutbound =
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; title: string; message: string; fatal: boolean };

export interface TestConnectionMessage {
  type: "test-connection";
  apiKey: string;
  model: string;
}

export interface GoogleTranslateMessage {
  type: "google-translate";
}

export interface OpenSettingsMessage {
  type: "open-settings";
}

export interface TranslateSelectionMessage {
  type: "translate-selection";
  text?: string;
}

export interface ShowPageMessage {
  type: "show-page-ai" | "show-page-google";
}

export interface PageAiControlMessage {
  type: "page-ai-start" | "page-ai-stop" | "page-ai-clear" | "page-ai-status";
}

export type ToWorkerMessage = TestConnectionMessage | GoogleTranslateMessage | OpenSettingsMessage;
export type ToPageMessage = TranslateSelectionMessage | ShowPageMessage | PageAiControlMessage;
