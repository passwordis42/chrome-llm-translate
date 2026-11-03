export interface LanguageOption {
  code: string;
  /** 设置页下拉文案 */
  label: string;
  /** 浮层 / 并排顶栏短标签 */
  short: string;
  /** 写进提示词的语言名 */
  promptName: string;
  /** 谷歌翻译 tl/sl */
  google: string;
}

export const TARGET_LANGUAGES: readonly LanguageOption[] = [
  { code: "zh", label: "中文", short: "中文", promptName: "简体中文", google: "zh-CN" },
  { code: "en", label: "English", short: "EN", promptName: "英语", google: "en" },
  { code: "ja", label: "日本語", short: "日语", promptName: "日语", google: "ja" },
  { code: "zh-Hant", label: "繁体中文", short: "繁体", promptName: "繁体中文", google: "zh-TW" },
  { code: "ko", label: "한국어", short: "韩语", promptName: "韩语", google: "ko" },
  { code: "fr", label: "Français", short: "FR", promptName: "法语", google: "fr" },
  { code: "de", label: "Deutsch", short: "DE", promptName: "德语", google: "de" },
  { code: "es", label: "Español", short: "ES", promptName: "西班牙语", google: "es" },
  { code: "pt", label: "Português", short: "PT", promptName: "葡萄牙语", google: "pt" },
  { code: "ru", label: "Русский", short: "RU", promptName: "俄语", google: "ru" },
  { code: "it", label: "Italiano", short: "IT", promptName: "意大利语", google: "it" },
  { code: "vi", label: "Tiếng Việt", short: "VI", promptName: "越南语", google: "vi" },
  { code: "th", label: "ไทย", short: "TH", promptName: "泰语", google: "th" },
  { code: "id", label: "Bahasa Indonesia", short: "ID", promptName: "印尼语", google: "id" },
  { code: "ar", label: "العربية", short: "AR", promptName: "阿拉伯语", google: "ar" },
] as const;

export const SOURCE_LANGUAGES: readonly LanguageOption[] = [
  { code: "auto", label: "自动检测", short: "自动", promptName: "自动检测", google: "auto" },
  ...TARGET_LANGUAGES,
];

const TARGET_CODES = new Set(TARGET_LANGUAGES.map((item) => item.code));
const SOURCE_CODES = new Set(SOURCE_LANGUAGES.map((item) => item.code));

export function isTargetLang(code: unknown): code is string {
  return typeof code === "string" && TARGET_CODES.has(code);
}

export function isSourceLang(code: unknown): code is string {
  return typeof code === "string" && SOURCE_CODES.has(code);
}

export function languageByCode(code: string): LanguageOption | undefined {
  return SOURCE_LANGUAGES.find((item) => item.code === code);
}

export function shortLabel(code: string): string {
  return languageByCode(code)?.short ?? code;
}

export function promptName(code: string): string {
  return languageByCode(code)?.promptName ?? code;
}

export function googleCode(code: string): string {
  return languageByCode(code)?.google ?? "zh-CN";
}

/** 仅用于浮层语言标签。源语言为自动时，看文字脚本猜一个短标签，猜不出就写「自动」。 */
export function guessSourceCode(text: string): string | null {
  const sample = text.slice(0, 500);
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const han = count(/\p{Script=Han}/gu);
  const kana = count(/\p{Script=Hiragana}/gu) + count(/\p{Script=Katakana}/gu);
  const hangul = count(/\p{Script=Hangul}/gu);
  const cyrillic = count(/\p{Script=Cyrillic}/gu);
  const arabic = count(/\p{Script=Arabic}/gu);
  const thai = count(/\p{Script=Thai}/gu);
  const latin = count(/\p{Script=Latin}/gu);
  if (kana >= 2) return "ja";
  const ranked: Array<[string, number]> = [
    ["ko", hangul],
    ["zh", han],
    ["ru", cyrillic],
    ["ar", arabic],
    ["th", thai],
    ["en", latin],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] < 2) return null;
  return ranked[0][0];
}

export function pairLabel(sourceLang: string, targetLang: string, sample?: string): string {
  const guessed = sourceLang === "auto" && sample ? guessSourceCode(sample) : null;
  const left = sourceLang === "auto" ? shortLabel(guessed ?? "auto") : shortLabel(sourceLang);
  return `${left} → ${shortLabel(targetLang)}`;
}
