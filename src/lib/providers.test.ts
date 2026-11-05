import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { NO_VISION_OCR_MESSAGE, PROVIDERS, PROVIDER_IDS, providerSupportsVision } from "./providers.ts";
import { PRICE_TABLE, estimateCost, rateFor } from "./pricing.ts";
import {
  emptyUsage,
  estimateView,
  loadQuotaView,
  nextUsage,
  parseDeepseekBalance,
  parseKimiBalance,
} from "./quota.ts";
import { buildChatBody, buildVisionBody, streamChat } from "./qwen.ts";
import { recognizeAndTranslate } from "./ocr.ts";
import { readSseStream } from "./sse.ts";
import {
  activateProvider,
  defaultSettings,
  isLegacySettingsRecord,
  normalizeSettings,
  resolveModelChoice,
  updateProviderSlot,
} from "./settings.ts";
import { runTranslationJob } from "./translate-job.ts";

const image = `data:image/jpeg;base64,${"abc".repeat(30)}`;

function sseOf(content: string, usage?: { prompt_tokens: number; completion_tokens: number }): string {
  const chunks = [`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`];
  if (usage) chunks.push(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  return chunks.join("");
}

describe("provider catalog", () => {
  it("lists five fixed endpoints and no editable base URL", () => {
    assert.deepEqual(PROVIDER_IDS, ["qwen", "openai", "volcano", "deepseek", "kimi"]);
    assert.equal(defaultSettings().provider, "qwen");
    assert.equal(PROVIDERS.qwen.chatCompletionsUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    assert.equal(PROVIDERS.openai.chatCompletionsUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(PROVIDERS.volcano.chatCompletionsUrl, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
    assert.equal(PROVIDERS.deepseek.chatCompletionsUrl, "https://api.deepseek.com/chat/completions");
    assert.equal(PROVIDERS.kimi.chatCompletionsUrl, "https://api.moonshot.cn/v1/chat/completions");
    assert.equal(PROVIDERS.deepseek.balance?.url, "https://api.deepseek.com/user/balance");
    assert.equal(PROVIDERS.kimi.balance?.url, "https://api.moonshot.cn/v1/users/me/balance");
    assert.equal(PROVIDERS.qwen.balance, null);
    assert.equal(PROVIDERS.openai.balance, null);
    assert.equal(PROVIDERS.volcano.balance, null);
    assert.equal(PROVIDERS.qwen.disableThinking, true);
    assert.equal(PROVIDERS.openai.disableThinking, false);

    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      version: string;
      host_permissions: string[];
    };
    assert.equal(manifest.version, "0.1.12");
    for (const id of PROVIDER_IDS) {
      const host = new URL(PROVIDERS[id].chatCompletionsUrl).host;
      assert.equal(manifest.host_permissions.some((item) => item.includes(host)), true, host);
      const balance = PROVIDERS[id].balance?.url;
      if (balance) {
        const balanceHost = new URL(balance).host;
        assert.equal(manifest.host_permissions.some((item) => item.includes(balanceHost)), true, balanceHost);
      }
    }

    const html = readFileSync(new URL("../popup/popup.html", import.meta.url), "utf8");
    const { document } = parseHTML(html);
    const options = [...document.querySelectorAll("#provider option")].map((option) => ({
      value: option.getAttribute("value"),
      label: option.textContent,
    }));
    assert.deepEqual(
      options,
      PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].label })),
    );
    assert.equal(document.querySelector("#base-url"), null);
    assert.equal(document.querySelector("#access-key"), null);
    assert.equal(html.includes("Base URL"), false);
    assert.match(html, /启用鼠标手势/);
    const settings = html.slice(html.indexOf('id="settings-view"'), html.indexOf('id="glossary-view"'));
    assert.equal(settings.includes('id="selection-toggle"'), false);
    assert.equal(settings.includes('id="force-select-toggle"'), false);
    assert.equal(settings.includes('id="open-glossary"'), false);
    assert.match(settings, /id="gesture-toggle"/);
    assert.match(document.querySelector("#quota-badge")?.textContent ?? "", /估算/);
    assert.match(document.querySelector("#quota-sub")?.textContent ?? "", /查不到账户余额/);
  });

  it("keeps vision on qwen, openai and volcano, and refuses it for deepseek and kimi", () => {
    assert.equal(providerSupportsVision("qwen"), true);
    assert.equal(providerSupportsVision("openai"), true);
    assert.equal(providerSupportsVision("volcano"), true);
    assert.equal(providerSupportsVision("deepseek"), false);
    assert.equal(providerSupportsVision("kimi"), false);
    assert.equal(NO_VISION_OCR_MESSAGE, "当前厂商不支持截图识译");
    assert.equal(PROVIDERS.volcano.estimateNote.includes("不收 AK/SK"), true);
    assert.equal(PROVIDERS.openai.estimateNote.includes("普通 sk-"), true);
  });
});

describe("settings migration", () => {
  it("moves a legacy key into the qwen slot and leaves the other four empty", () => {
    const legacy = {
      apiKey: " sk-legacy ",
      model: " qwen-plus ",
      visionModel: " qwen-vl-max ",
      provider: "openai",
      sourceLang: "en",
      targetLang: "ja",
      selectionMode: "immediate",
      glossary: [{ id: "1", source: "API", target: "接口" }],
    };
    assert.equal(isLegacySettingsRecord(legacy), true);
    const settings = normalizeSettings(legacy);
    assert.equal(settings.provider, "qwen");
    assert.equal(settings.apiKey, "sk-legacy");
    assert.equal(settings.model, "qwen-plus");
    assert.equal(settings.visionModel, "qwen-vl-max");
    assert.equal(settings.providers.qwen.apiKey, "sk-legacy");
    assert.equal(settings.providers.qwen.model, "qwen-plus");
    assert.equal(settings.providers.openai.apiKey, "");
    assert.equal(settings.providers.openai.model, "gpt-4o-mini");
    assert.equal(settings.targetLang, "ja");
    assert.equal(settings.selectionMode, "immediate");
    assert.equal(settings.glossary.length, 1);
    assert.equal(isLegacySettingsRecord(settings), false);
    const again = normalizeSettings(settings);
    assert.equal(again.apiKey, "sk-legacy");
    assert.equal(again.providers.qwen.visionModel, "qwen-vl-max");
    assert.equal(again.providers.kimi.apiKey, "");
  });

  it("switches providers without overwriting the other keys", () => {
    const migrated = normalizeSettings({ apiKey: "sk-qwen", model: "qwen-plus", visionModel: "qwen-vl-max" });
    const openai = activateProvider(
      updateProviderSlot(migrated, "openai", { apiKey: "sk-oai", model: "gpt-4o" }),
      "openai",
    );
    assert.equal(openai.provider, "openai");
    assert.equal(openai.apiKey, "sk-oai");
    assert.equal(openai.model, "gpt-4o");
    assert.equal(openai.visionModel, "gpt-4o");
    assert.equal(openai.providers.qwen.apiKey, "sk-qwen");
    assert.equal(openai.providers.qwen.model, "qwen-plus");
    assert.equal(openai.providers.qwen.visionModel, "qwen-vl-max");

    const back = activateProvider(openai, "qwen");
    assert.equal(back.provider, "qwen");
    assert.equal(back.apiKey, "sk-qwen");
    assert.equal(back.model, "qwen-plus");
    assert.equal(back.visionModel, "qwen-vl-max");
    assert.equal(back.providers.openai.apiKey, "sk-oai");
    assert.equal(back.providers.openai.model, "gpt-4o");
  });

  it("accepts a volcano endpoint id and rejects a broken one", () => {
    assert.deepEqual(resolveModelChoice("doubao-seed-1.6", " ep-20241104abcdef ", "volcano"), {
      ok: true,
      model: "ep-20241104abcdef",
      source: "custom",
    });
    const invalid = resolveModelChoice("doubao-seed-1.6", "not an id", "volcano");
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.match(invalid.message, /不会假翻/);
    const kimi = normalizeSettings({
      provider: "kimi",
      providers: {
        qwen: { apiKey: "sk-q", model: "qwen3.7-plus", visionModel: "qwen3-vl-plus" },
        openai: { apiKey: "sk-o", model: "gpt-4o-mini", visionModel: "" },
        volcano: { apiKey: "ark", model: "ep-20241104abcdef", visionModel: "" },
        deepseek: { apiKey: "sk-d", model: "deepseek-chat", visionModel: "" },
        kimi: { apiKey: "sk-k", model: "bad model", visionModel: "" },
      },
    });
    assert.equal(kimi.provider, "kimi");
    assert.equal(kimi.model, "moonshot-v1-8k");
    assert.equal(kimi.apiKey, "sk-k");
    assert.equal(kimi.providers.qwen.apiKey, "sk-q");
    assert.equal(kimi.providers.volcano.model, "ep-20241104abcdef");
    assert.equal(kimi.providers.openai.apiKey, "sk-o");
  });
});

describe("provider routing", () => {
  it("posts the active provider and omits qwen-only fields", async () => {
    const openaiBody = buildChatBody({
      model: "gpt-4o-mini",
      user: "hi",
      stream: true,
      provider: "openai",
    });
    assert.equal("enable_thinking" in openaiBody, false);
    assert.deepEqual(openaiBody.stream_options, { include_usage: true });

    const kimiBody = buildChatBody({
      model: "moonshot-v1-8k",
      user: "hi",
      stream: true,
      provider: "kimi",
    });
    assert.equal("enable_thinking" in kimiBody, false);
    assert.equal(kimiBody.stream_options, undefined);

    const reasoner = buildChatBody({
      model: "deepseek-reasoner",
      user: "hi",
      stream: true,
      provider: "deepseek",
    });
    assert.equal("temperature" in reasoner, false);
    assert.equal(reasoner.enable_thinking, undefined);

    const qwenBody = buildChatBody({ model: "qwen3.7-plus", user: "hi", stream: true });
    assert.equal(qwenBody.enable_thinking, false);

    const settings = defaultSettings();
    settings.provider = "volcano";
    settings.apiKey = "ark-key";
    settings.model = "ep-20241104abcdef";
    let requestUrl = "";
    let sentModel = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = String(input);
      sentModel = (JSON.parse(String(init?.body)) as { model: string }).model;
      const headers = init?.headers as { Authorization: string };
      assert.equal(headers.Authorization, "Bearer ark-key");
      return new Response(sseOf("ok"), { status: 200 });
    };
    await runTranslationJob({
      text: "hello",
      settings,
      signal: new AbortController().signal,
      onText: () => undefined,
      fetchImpl,
    });
    assert.equal(requestUrl, PROVIDERS.volcano.chatCompletionsUrl);
    assert.equal(sentModel, "ep-20241104abcdef");
  });

  it("keeps qwen vision on dashscope and refuses deepseek before any request", async () => {
    const qwen = defaultSettings();
    qwen.apiKey = "sk-qwen";
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      if (urls.length === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "Hello" } }] }), { status: 200 });
      }
      return new Response(sseOf("你好"), { status: 200 });
    };
    const seen = await recognizeAndTranslate({
      imageDataUrl: image,
      settings: qwen,
      signal: new AbortController().signal,
      fetchImpl,
    });
    assert.deepEqual(urls, [PROVIDERS.qwen.chatCompletionsUrl, PROVIDERS.qwen.chatCompletionsUrl]);
    assert.equal(seen.translation, "你好");
    const vision = buildVisionBody({ model: "qwen3-vl-plus", prompt: "抄", imageDataUrl: image });
    assert.equal(vision.enable_thinking, false);

    const deepseek = activateProvider(
      updateProviderSlot(defaultSettings(), "deepseek", { apiKey: "sk-ds", model: "deepseek-chat" }),
      "deepseek",
    );
    let called = false;
    const never: typeof fetch = async () => {
      called = true;
      return new Response("no", { status: 500 });
    };
    await assert.rejects(
      () => recognizeAndTranslate({
        imageDataUrl: image,
        settings: deepseek,
        signal: new AbortController().signal,
        fetchImpl: never,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /当前厂商不支持截图识译/);
        assert.match(error.message, /不会假翻/);
        return true;
      },
    );
    assert.equal(called, false);
  });

  it("reads usage from the trailing SSE chunk", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseOf("你好", { prompt_tokens: 11, completion_tokens: 2 })));
        controller.close();
      },
    });
    let text = "";
    const result = await readSseStream(stream, (delta) => {
      text += delta;
    });
    assert.equal(text, "你好");
    assert.deepEqual(result.usage, { promptTokens: 11, completionTokens: 2 });

    let seenUsage: unknown;
    await streamChat({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      provider: "openai",
      system: "s",
      user: "u",
      signal: new AbortController().signal,
      onDelta: () => undefined,
      fetchImpl: async (input, init) => {
        assert.equal(String(input), PROVIDERS.openai.chatCompletionsUrl);
        const body = JSON.parse(String(init?.body)) as { enable_thinking?: boolean };
        assert.equal(body.enable_thinking, undefined);
        return new Response(sseOf("OK", { prompt_tokens: 4, completion_tokens: 1 }), { status: 200 });
      },
    }).then((result) => {
      seenUsage = result.usage;
    });
    assert.deepEqual(seenUsage, { promptTokens: 4, completionTokens: 1 });
  });
});

describe("quota line", () => {
  it("prices tokens from the public table and does not invent money without usage", () => {
    assert.equal(PRICE_TABLE.openai.currency, "USD");
    assert.equal(PRICE_TABLE.qwen.currency, "CNY");
    assert.equal(PRICE_TABLE.volcano.currency, "CNY");
    assert.equal(estimateCost("openai", "gpt-4o-mini", { promptTokens: 1_000_000, completionTokens: 1_000_000 }), 0.75);
    assert.equal(rateFor("qwen", "qwen-plus").input, PRICE_TABLE.qwen.input);
    assert.equal(estimateCost("kimi", "moonshot-v1-128k", { promptTokens: 1_000_000, completionTokens: 0 }), 60);

    const priced = nextUsage("openai", "gpt-4o-mini", emptyUsage(), { promptTokens: 1_000_000, completionTokens: 0 });
    const view = estimateView("openai", priced);
    assert.equal(view.badge, "估算");
    assert.equal(view.tone, "estimate");
    assert.equal(view.main, "本次约 $0.15 · 本扩展累计估算 $0.15");
    assert.match(view.sub, /普通 sk-/);
    assert.equal(view.main.includes("账户剩余"), false);

    const again = nextUsage("openai", "gpt-4o-mini", priced, { promptTokens: 1_000_000, completionTokens: 0 });
    assert.equal(estimateView("openai", again).main, "本次约 $0.15 · 本扩展累计估算 $0.30");

    const missing = nextUsage("qwen", "qwen3.7-plus", emptyUsage(), null);
    const missingView = estimateView("qwen", missing);
    assert.match(missingView.main, /未返回用量/);
    assert.match(missingView.main, /未估金额/);
    assert.match(missingView.sub, /没有 usage/);
    assert.equal(missing.cumulativeCost, 0);

    const fresh = estimateView("volcano", emptyUsage());
    assert.match(fresh.main, /本次暂无用量/);
    assert.match(fresh.sub, /不收 AK\/SK/);
    assert.equal(fresh.badge, "估算");
  });

  it("shows a real balance for deepseek and kimi, and never calls balance for the other three", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response("no", { status: 500 });
    };
    for (const provider of ["qwen", "openai", "volcano"] as const) {
      const view = await loadQuotaView({
        provider,
        apiKey: "sk-test",
        usage: emptyUsage(),
        fetchImpl,
      });
      assert.equal(view.tone, "estimate");
      assert.equal(view.badge, "估算");
      assert.equal(view.main.includes("账户剩余"), false);
      assert.equal(view.main.includes("可用余额"), false);
    }
    assert.deepEqual(calls, []);

    const deepseek = await loadQuotaView({
      provider: "deepseek",
      apiKey: "sk-ds",
      usage: emptyUsage(),
      fetchImpl: async (input, init) => {
        assert.equal(String(input), "https://api.deepseek.com/user/balance");
        assert.equal((init?.headers as { Authorization: string }).Authorization, "Bearer sk-ds");
        assert.equal(init?.method, "GET");
        return new Response(JSON.stringify({
          is_available: true,
          balance_infos: [{ currency: "CNY", total_balance: "12.34", granted_balance: "0.00", topped_up_balance: "12.34" }],
        }), { status: 200 });
      },
    });
    assert.equal(deepseek.tone, "balance");
    assert.equal(deepseek.badge, "余额");
    assert.equal(deepseek.main, "账户剩余 ¥12.34");
    assert.match(deepseek.sub, /\/user\/balance/);

    const kimi = await loadQuotaView({
      provider: "kimi",
      apiKey: "sk-kimi",
      usage: emptyUsage(),
      fetchImpl: async () => new Response(JSON.stringify({
        code: 0,
        status: true,
        data: { available_balance: 28.5, voucher_balance: 0, cash_balance: 28.5 },
      }), { status: 200 }),
    });
    assert.equal(kimi.main, "可用余额 ¥28.50");
    assert.match(kimi.sub, /available_balance/);
    assert.equal(parseKimiBalance({ available_balance: "28.50" })?.amount, 28.5);
    assert.equal(parseDeepseekBalance({ balance_infos: [] }), null);

    const failed = await loadQuotaView({
      provider: "deepseek",
      apiKey: "sk-bad",
      usage: nextUsage("deepseek", "deepseek-chat", emptyUsage(), { promptTokens: 1_000_000, completionTokens: 0 }),
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: "invalid" } }), { status: 401 }),
    });
    assert.equal(failed.tone, "estimate");
    assert.equal(failed.badge, "估算");
    assert.match(failed.sub, /余额查询失败：Key 无效或无权限/);
    assert.match(failed.sub, /已改为本地估算/);
    assert.match(failed.main, /本次约 ¥2\.00/);
    assert.equal(failed.main.includes("账户剩余"), false);

    const emptyKey = await loadQuotaView({
      provider: "kimi",
      apiKey: "  ",
      usage: emptyUsage(),
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    assert.equal(emptyKey.main, "尚未填写 API Key");
    assert.equal(emptyKey.tone, "estimate");
    assert.match(emptyKey.sub, /users\/me\/balance/);
  });
});
