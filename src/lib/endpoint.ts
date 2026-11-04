/**
 * 通义千问 · DashScope OpenAI 兼容模式（中国站）。
 * 其他四家的固定端点在 providers.ts，本版不能在设置里改 Base URL。
 *
 * POST {QWEN_CHAT_COMPLETIONS_URL}
 * Authorization: Bearer <用户自己的 API Key>
 * body: { model, messages, stream: true, temperature, enable_thinking: false }
 *
 * 国际站（新加坡）Key 不能打中国站域名。把下面的 host 换成
 * dashscope-intl.aliyuncs.com 后重新 npm run build。
 * manifest 已同时声明两个 host，换常量即可，不必改权限。
 */
export const QWEN_CHAT_COMPLETIONS_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
