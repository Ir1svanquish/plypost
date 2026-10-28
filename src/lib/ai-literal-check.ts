export type LiteralChanges = { missing: string[]; added: string[] };

type Literal = { key: string; label: string };

const weekdays: Record<string, string> = {
  mon: "monday", monday: "monday", tue: "tuesday", tues: "tuesday", tuesday: "tuesday",
  wed: "wednesday", wednesday: "wednesday", thu: "thursday", thur: "thursday",
  thurs: "thursday", thursday: "thursday", fri: "friday", friday: "friday",
  sat: "saturday", saturday: "saturday", sun: "sunday", sunday: "sunday",
};

const relativeTimes = [
  ["today", /\btoday\b|今天/giu], ["tomorrow", /\btomorrow\b|明天/giu],
  ["yesterday", /\byesterday\b|昨天/giu],
  ["this week", /\bthis week\b|本周|这周|这个星期|本星期/giu],
  ["last week", /\blast week\b|上周|上星期|上个星期/giu],
  ["next week", /\bnext week\b|下周|下星期|下个星期/giu],
  ["this month", /\bthis month\b|本月|这月|这个月/giu],
  ["last month", /\blast month\b|上月|上个月/giu],
  ["next month", /\bnext month\b|下月|下个月/giu],
  ["this year", /\bthis year\b|今年/giu],
  ["last year", /\blast year\b|去年/giu],
  ["next year", /\bnext year\b|明年/giu],
] as const;

function literals(text: string): Literal[] {
  const found = new Map<string, string>();
  const add = (kind: string, label: string, normalized = label) => {
    const key = `${kind}:${normalized}`;
    if (!found.has(key)) found.set(key, label);
  };

  let rest = text.replace(/(?:https?:\/\/|www\.)[^\s<>"'`]+/giu, (raw) => {
    const link = raw.replace(/[.,;!?)\]}]+$/u, "");
    if (link) add("url", link);
    return " ";
  });
  rest = rest.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, (email) => {
    add("email", email, email.toLocaleLowerCase());
    return " ";
  });
  rest = rest.replace(/(^|[^\p{L}\p{N}_])([@#][\p{L}\p{N}_.-]+)/gu, (_match, prefix: string, raw: string) => {
    const tag = raw.replace(/[.-]+$/u, "");
    if (tag.length > 1) add("tag", tag, tag.toLocaleLowerCase());
    return `${prefix} `;
  });
  for (const [normalized, pattern] of relativeTimes) {
    for (const match of rest.matchAll(pattern)) add("relative-time", match[0], normalized);
  }
  for (const match of rest.matchAll(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thurs?|fri|sat|sun)\b/giu)) {
    add("weekday", match[0], weekdays[match[0].toLocaleLowerCase()]);
  }
  for (const match of rest.matchAll(/(?:星期|周|礼拜)[一二三四五六日天]/gu)) {
    add("weekday", match[0], match[0].at(-1) === "天" ? "日" : match[0].at(-1));
  }
  for (const match of rest.matchAll(/(?:^|[^a-z])([ap]\.?m\.?)(?![a-z])/giu)) {
    add("time", match[1], match[1].toLocaleLowerCase().startsWith("a") ? "am" : "pm");
  }
  for (const match of rest.matchAll(/上午|下午|早上|晚上|中午|凌晨/gu)) {
    const period = match[0] === "上午" || match[0] === "早上" ? "am"
      : match[0] === "下午" ? "pm" : match[0];
    add("time", match[0], period);
  }
  rest = rest.replace(/\b(\d{1,2}):([0-5]\d)\b/gu, (_match, hour: string, minute: string) => {
    const normalizedHour = String(Number(hour));
    if (minute === "00") add("number", normalizedHour, normalizedHour);
    else add("clock", `${hour}:${minute}`, `${normalizedHour}:${minute}`);
    return " ";
  });
  for (const match of rest.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)) {
    const number = match[0];
    add("number", number, number.replace(/,(?=\d{3}(?:$|[.,]))/g, "").replace(/^0+(?=\d)/, ""));
  }
  return [...found].map(([key, label]) => ({ key, label }));
}

/** A limited local check of exact details, not a claim that the suggestion is factually correct. */
export function compareAiLiterals(source: string, suggestion: string): LiteralChanges {
  const before = literals(source);
  const after = literals(suggestion);
  const beforeKeys = new Set(before.map((item) => item.key));
  const afterKeys = new Set(after.map((item) => item.key));
  const addedPerspective = /[?？]\s*$/u.test(source.trim()) &&
    (/(?:^|[^\p{L}])(?:you|your|yours)(?!\p{L})/iu.test(source) || source.includes("你")) &&
    !/(?:^|[^\p{L}])(?:i|me|my|mine|we|us|our|ours)(?!\p{L})/iu.test(source) && !source.includes("我")
    ? suggestion.match(/(?:^|[^\p{L}])(i|me|my|mine|we|us|our|ours)(?!\p{L})/iu)?.[1] ??
      (suggestion.includes("我") ? "我" : null)
    : null;
  return {
    missing: before.filter((item) => !afterKeys.has(item.key)).map((item) => item.label),
    added: [
      ...after.filter((item) => !beforeKeys.has(item.key)).map((item) => item.label),
      ...(addedPerspective ? [`first-person wording (${addedPerspective})`] : []),
    ],
  };
}
