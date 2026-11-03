export interface ParsedEvent {
  content: string;
  done: boolean;
  error?: string;
}

export function parseSseBuffer(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts.filter((part) => part.trim().length > 0), rest };
}

export function parseEvent(event: string): ParsedEvent {
  let content = "";
  let done = false;
  let error: string | undefined;
  for (const line of event.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const json = JSON.parse(data) as {
        error?: { message?: unknown };
        message?: unknown;
        choices?: Array<{
          delta?: { content?: unknown; reasoning_content?: unknown };
          message?: { content?: unknown };
        }>;
      };
      if (json.error) {
        error = typeof json.error.message === "string" ? json.error.message : "请求被拒绝";
      }
      const delta = json.choices?.[0]?.delta?.content;
      const message = json.choices?.[0]?.message?.content;
      if (typeof delta === "string") content += delta;
      else if (typeof message === "string") content += message;
    } catch {
      // 半包或心跳，交给调用方留在 rest 里；这里的单事件解析失败就跳过。
    }
  }
  return { content, done, error };
}

export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<{ received: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = false;
  const handle = (event: string) => {
    const parsed = parseEvent(event);
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    if (parsed.content) {
      received = true;
      onDelta(parsed.content);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) handle(event);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
  } finally {
    reader.releaseLock();
  }
  return { received };
}
