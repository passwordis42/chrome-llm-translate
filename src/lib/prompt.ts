import type { GlossaryToken } from "./glossary.ts";
import { promptName } from "./languages.ts";

export function buildSystemPrompt(opts: {
  sourceLang: string;
  targetLang: string;
  tokens: GlossaryToken[];
}): string {
  const target = promptName(opts.targetLang);
  const sourceLine =
    opts.sourceLang === "auto"
      ? "先判断源语言。"
      : `源语言是${promptName(opts.sourceLang)}。`;
  const lines = [
    `你是专业翻译。${sourceLine}把用户文本翻译成${target}。`,
    "只输出译文本身，不要解释、不要加引号、不要加标题或前言。",
    "保留原有换行。代码、URL、版本号、已经是目标语言的专名保持原样。",
  ];
  if (opts.tokens.length > 0) {
    lines.push("用户文本里的占位符必须原样出现在译文的对应位置，不要翻译、不要改写、不要拆开括号。固定译法优先于你自己的措辞：");
    for (const token of opts.tokens) {
      lines.push(`${token.token} 表示「${token.source}」，固定译法是「${token.target}」。输出时只写 ${token.token}。`);
    }
  }
  return lines.join("\n");
}
