import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QWEN_CHAT_COMPLETIONS_URL } from "./endpoint.ts";
import { TranslateError } from "./errors.ts";
import { defaultSettings } from "./settings.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { runTranslationJob } from "./translate-job.ts";
import { buildChatBody } from "./qwen.ts";
import { readSseStream } from "./sse.ts";

function sseOf(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
}

describe("qwen request", () => {
  it("posts to DashScope compatible chat completions and disables thinking", () => {
    const body = buildChatBody({
      model: "qwen-plus",
      system: "sys",
      user: "hello",
      stream: true,
    });
    assert.equal(body.model, "qwen-plus");
    assert.equal(body.stream, true);
    assert.equal(body.enable_thinking, false);
    assert.equal(QWEN_CHAT_COMPLETIONS_URL, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  it("reassembles SSE deltas split across chunks and ignores reasoning text", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你","reasoning_content":"skip"}}]}\n\ndata: {"choices":[{"delta":{"con',
      'tent":"好"}}]}\n\ndata: [DONE]\n\n',
    ];
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    let text = "";
    const result = await readSseStream(stream, (delta) => {
      text += delta;
    });
    assert.equal(result.received, true);
    assert.equal(text, "你好");
  });
});

describe("runTranslationJob", () => {
  it("asks the model to keep glossary tokens and restores them", async () => {
    const settings = defaultSettings();
    settings.apiKey = "sk-test-key";
    settings.glossary = [{ id: "1", source: "large language model", target: "大语言模型" }];
    let requestUrl = "";
    let userText = "";
    let systemText = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
        enable_thinking: boolean;
      };
      assert.equal(body.enable_thinking, false);
      systemText = body.messages[0].content;
      userText = body.messages[1].content;
      const headers = init?.headers as { Authorization: string };
      assert.equal(headers.Authorization, "Bearer sk-test-key");
      return new Response(sseOf(`${userText} 很好`), { status: 200 });
    };
    let shown = "";
    await runTranslationJob({
      text: "The large language model helps.",
      settings,
      signal: new AbortController().signal,
      onText: (text) => {
        shown = text;
      },
      fetchImpl,
    });
    assert.equal(requestUrl, QWEN_CHAT_COMPLETIONS_URL);
    assert.equal(userText.includes("large language model"), false);
    assert.match(userText, /\[\[YF0\]\]/);
    assert.match(systemText, /固定译法/);
    assert.match(systemText, /大语言模型/);
    assert.equal(shown.includes("大语言模型"), true);
    assert.equal(shown.includes("large language model"), false);
    assert.match(shown, /很好/);
  });

  it("does not call the API or invent a translation when the key is missing", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("no", { status: 500 });
    };
    await assert.rejects(
      () =>
        runTranslationJob({
          text: "SECRET_SOURCE_SENTENCE",
          settings: defaultSettings(),
          signal: new AbortController().signal,
          onText: () => {
            throw new Error("should not emit text");
          },
          fetchImpl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof TranslateError);
        assert.equal(error.code, "no_key");
        assert.equal(error.fatal, true);
        assert.equal(error.message.includes("SECRET_SOURCE_SENTENCE"), false);
        assert.match(error.message, /不会假翻/);
        return true;
      },
    );
    assert.equal(called, false);
  });

  it("surfaces an invalid key without echoing the source", async () => {
    const settings = defaultSettings();
    settings.apiKey = "sk-bad-key";
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Incorrect API key sk-bad-key" } }), { status: 401 });
    await assert.rejects(
      () =>
        runTranslationJob({
          text: "SECRET_SOURCE_SENTENCE",
          settings,
          signal: new AbortController().signal,
          onText: () => {
            throw new Error("should not emit text");
          },
          fetchImpl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof TranslateError);
        assert.equal(error.code, "auth");
        assert.equal(error.message.includes("SECRET_SOURCE_SENTENCE"), false);
        assert.equal(error.message.includes("sk-bad-key"), false);
        assert.match(error.message, /API Key 无效或网络不可达/);
        assert.match(error.message, /不会假翻/);
        return true;
      },
    );
  });

  it("reports network failures as network failures", async () => {
    const settings = defaultSettings();
    settings.apiKey = "sk-test-key";
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(
      () =>
        runTranslationJob({
          text: "hello",
          settings,
          signal: new AbortController().signal,
          onText: () => undefined,
          fetchImpl,
        }),
      (error: unknown) => {
        assert.ok(error instanceof TranslateError);
        assert.equal(error.code, "network");
        assert.match(error.message, /不会假翻/);
        return true;
      },
    );
  });
});

describe("prompt", () => {
  it("mentions the target language and nothing but the translation", () => {
    const prompt = buildSystemPrompt({ sourceLang: "en", targetLang: "zh", tokens: [] });
    assert.match(prompt, /简体中文/);
    assert.match(prompt, /只输出译文/);
  });
});
