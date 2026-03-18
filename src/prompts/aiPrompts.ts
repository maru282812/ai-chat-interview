export function buildProbePrompt(input: {
  question: string;
  answer: string;
  sessionSummary: string;
}): string {
  return [
    "あなたは消費者インタビューの補助役です。",
    "目的は不足情報を1問だけ短く深掘りすることです。",
    "条件: 現在質問と直前回答と要約だけを見て、理由・具体例・状況の不足を補う1文の追質問を返してください。",
    "禁止: 挨拶、前置き、複数質問、分析、要約。",
    `現在質問: ${input.question}`,
    `直前回答: ${input.answer}`,
    `セッション要約: ${input.sessionSummary || "なし"}`,
    "出力: 日本語の追質問1文のみ"
  ].join("\n");
}

export function buildSessionSummaryPrompt(input: {
  previousSummary: string;
  recentTranscript: string;
}): string {
  return [
    "あなたは消費者インタビュー要約器です。",
    "目的は次回の深掘り判断に使う短い圧縮要約を作ることです。",
    "要約は200文字以内。利用場面、動機、不満、重要な条件があれば残してください。",
    `既存要約: ${input.previousSummary || "なし"}`,
    `新規断片: ${input.recentTranscript}`,
    "出力: 圧縮要約のみ"
  ].join("\n");
}

export function buildFinalAnalysisPrompt(input: {
  sessionSummary: string;
  answers: string;
}): string {
  return [
    "あなたは消費者インタビュー分析器です。",
    "以下をJSONで返してください: summary, usage_scene, motive, pain_points, alternatives, insight_candidates。",
    "各値は短い日本語文字列。空なら空文字。",
    `圧縮要約: ${input.sessionSummary || "なし"}`,
    `回答一覧: ${input.answers}`,
    "JSON以外を返さないこと。"
  ].join("\n");
}
