import type { FlexContainer, LineFlexMessage, LineMessage, Rank } from "../types/domain";

function bubble(bodyContents: unknown[]): FlexContainer {
  return {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: bodyContents
    }
  };
}

export function buildWelcomeMessages(): LineMessage[] {
  return [
    {
      type: "text",
      text: "ご登録ありがとうございます。LINE上で短時間のインタビューに参加できます。所要時間は5〜10分、完了でポイントを獲得できます。"
    },
    {
      type: "text",
      text: "「はじめる」で開始、「再開」で続きから再開、「マイページ」で基本情報の登録・確認ができます。"
    },
    {
      type: "text",
      text: "ご利用にあたっては、利用規約・プライバシーポリシーへの同意が必要です。「マイページ」を開くと内容をご確認のうえ同意いただけます。"
    }
  ];
}

export function buildMypageLiffFlex(url: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "マイページ（基本情報）",
    contents: bubble([
      {
        type: "text",
        text: "マイページ",
        size: "xl",
        weight: "bold"
      },
      {
        type: "text",
        text: "ニックネーム・住所・職業などの基本情報を確認・編集できます。",
        size: "sm",
        wrap: true,
        color: "#666666"
      },
      {
        type: "separator"
      },
      {
        type: "button",
        action: {
          type: "uri",
          label: "マイページを開く",
          uri: url
        },
        style: "primary",
        color: "#0B7A75"
      }
    ])
  };
}

export function buildCompletionFlex(points: number, totalPoints: number, rankName: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "回答完了のお知らせ",
    contents: bubble([
      {
        type: "text",
        text: "インタビュー完了",
        weight: "bold",
        size: "xl"
      },
      {
        type: "text",
        text: `今回獲得: +${points} pt`,
        size: "lg",
        color: "#0B7A75",
        weight: "bold"
      },
      {
        type: "text",
        text: `累計: ${totalPoints} pt`,
        size: "md"
      },
      {
        type: "text",
        text: `現在ランク: ${rankName}`,
        size: "md"
      },
      {
        type: "text",
        text: "次の案件もLINEから参加できます。",
        wrap: true,
        size: "sm",
        color: "#666666"
      }
    ])
  };
}

export function buildRankFlex(input: {
  rankName: string;
  badgeLabel: string;
  totalPoints: number;
  nextRank?: Rank | null;
  pointsToNext?: number | null;
}): LineFlexMessage {
  const nextLine =
    input.nextRank && input.pointsToNext !== null && input.pointsToNext !== undefined
      ? `次の ${input.nextRank.rank_name} まであと ${input.pointsToNext} pt`
      : "最高ランクに到達しています";

  return {
    type: "flex",
    altText: "ランク情報",
    contents: bubble([
      {
        type: "text",
        text: "My Rank",
        size: "sm",
        color: "#888888"
      },
      {
        type: "text",
        text: input.rankName,
        size: "xxl",
        weight: "bold"
      },
      {
        type: "text",
        text: input.badgeLabel,
        size: "md",
        color: "#C26D00"
      },
      {
        type: "separator"
      },
      {
        type: "text",
        text: `累計ポイント: ${input.totalPoints} pt`,
        size: "md"
      },
      {
        type: "text",
        text: nextLine,
        size: "sm",
        wrap: true,
        color: "#666666"
      }
    ])
  };
}

export function buildMypageFlex(input: {
  rankName: string;
  badgeLabel: string;
  totalPoints: number;
  nextRank?: Rank | null;
  pointsToNext?: number | null;
  hasActiveSession: boolean;
}): LineFlexMessage {
  const nextAction = input.hasActiveSession
    ? "未完了案件があります。「再開」で続きから回答できます。"
    : "参加可能な案件があれば「はじめる」で開始できます。";

  return {
    type: "flex",
    altText: "マイページ",
    contents: bubble([
      {
        type: "text",
        text: "マイページ",
        size: "xl",
        weight: "bold"
      },
      {
        type: "text",
        text: `${input.rankName} / ${input.totalPoints} pt`,
        size: "lg",
        weight: "bold"
      },
      {
        type: "text",
        text: input.badgeLabel,
        size: "sm",
        color: "#C26D00"
      },
      {
        type: "text",
        text:
          input.nextRank && input.pointsToNext !== null && input.pointsToNext !== undefined
            ? `次ランク ${input.nextRank.rank_name} まであと ${input.pointsToNext} pt`
            : "最高ランク到達中",
        size: "sm",
        wrap: true
      },
      {
        type: "separator"
      },
      {
        type: "text",
        text: nextAction,
        size: "sm",
        wrap: true,
        color: "#666666"
      }
    ])
  };
}

export function buildProjectStartFlex(input: {
  projectName: string;
  url: string;
}): LineFlexMessage {
  return {
    type: "flex",
    altText: `${input.projectName} - 回答を開始する`,
    contents: bubble([
      {
        type: "text",
        text: input.projectName,
        size: "xl",
        weight: "bold",
        wrap: true
      },
      {
        type: "text",
        text: "この案件は専用画面で回答します。以下から開始してください。",
        size: "sm",
        wrap: true,
        color: "#666666"
      },
      {
        type: "separator"
      },
      {
        type: "button",
        action: {
          type: "uri",
          label: "回答を開始する",
          uri: input.url
        },
        style: "primary",
        color: "#0B7A75"
      }
    ])
  };
}

/**
 * デイリーの「今日の1問」をトーク内でそのまま選ばせるバブル。
 * ボタンは postback アクション（LIFF を開かせない）。displayText を付けて、
 * 押した選択肢が自分の発言としてトークに残るようにする。
 */
export function buildDailyQuestionFlex(input: {
  questionText: string;
  rewardLabel: string;
  options: Array<{ label: string; data: string }>;
}): LineFlexMessage {
  return {
    type: "flex",
    altText: input.questionText,
    contents: bubble([
      {
        type: "box",
        layout: "horizontal",
        contents: [
          {
            type: "text",
            text: "☀️ 今日の1問",
            size: "sm",
            weight: "bold",
            color: "#0B7A75"
          },
          {
            type: "text",
            text: input.rewardLabel,
            size: "sm",
            weight: "bold",
            color: "#C26D00",
            align: "end"
          }
        ]
      },
      {
        type: "text",
        text: input.questionText,
        size: "lg",
        weight: "bold",
        wrap: true
      },
      {
        type: "separator"
      },
      ...input.options.map((option) => ({
        type: "button",
        action: {
          type: "postback",
          label: option.label,
          data: option.data,
          displayText: option.label
        },
        style: "secondary",
        height: "sm"
      }))
    ])
  };
}

export function buildRankUpMessages(newRankName: string): LineMessage[] {
  return [
    {
      type: "text",
      text: `ランクアップしました。現在のランクは ${newRankName} です。`
    }
  ];
}

export function buildNewProjectNotificationFlex(input: {
  projectTitle: string;
  category?: string | null;
  rewardPoints?: number | null;
  estimatedMinutes?: number | null;
  url: string;
}): LineFlexMessage {
  const meta: string[] = [];
  if (input.rewardPoints) meta.push(`謝礼 ${input.rewardPoints}pt`);
  if (input.estimatedMinutes) meta.push(`約${input.estimatedMinutes}分`);
  if (input.category) meta.push(input.category);

  return {
    type: "flex",
    altText: `新着案件: ${input.projectTitle}`,
    contents: bubble([
      {
        type: "text",
        text: "新着案件のご案内",
        size: "sm",
        color: "#888888"
      },
      {
        type: "text",
        text: input.projectTitle,
        size: "xl",
        weight: "bold",
        wrap: true
      },
      ...(meta.length > 0 ? [{
        type: "text",
        text: meta.join("  /  "),
        size: "sm",
        color: "#2ca87a",
        wrap: true
      }] : []),
      {
        type: "separator"
      },
      {
        type: "button",
        action: {
          type: "uri",
          label: "案件を確認する",
          uri: input.url
        },
        style: "primary",
        color: "#0B7A75"
      }
    ])
  };
}

export function buildApplicationAcceptedFlex(input: {
  projectTitle: string;
  rewardPoints?: number | null;
  estimatedMinutes?: number | null;
  surveyUrl: string;
}): LineFlexMessage {
  const meta: string[] = [];
  if (input.rewardPoints) meta.push(`謝礼 ${input.rewardPoints}pt`);
  if (input.estimatedMinutes) meta.push(`約${input.estimatedMinutes}分`);

  return {
    type: "flex",
    altText: `【当選】${input.projectTitle}`,
    contents: bubble([
      {
        type: "text",
        text: "🎉 当選のお知らせ",
        size: "sm",
        color: "#0B7A75",
        weight: "bold"
      },
      {
        type: "text",
        text: input.projectTitle,
        size: "xl",
        weight: "bold",
        wrap: true
      },
      {
        type: "text",
        text: "ご応募いただいた案件に当選しました。以下から回答をはじめてください。",
        size: "sm",
        color: "#555555",
        wrap: true
      },
      ...(meta.length > 0 ? [{
        type: "text",
        text: meta.join("  /  "),
        size: "sm",
        color: "#2ca87a",
        wrap: true
      }] : []),
      {
        type: "separator"
      },
      {
        type: "button",
        action: {
          type: "uri",
          label: "回答をはじめる",
          uri: input.surveyUrl
        },
        style: "primary",
        color: "#0B7A75"
      }
    ])
  };
}

export function buildApplicationRejectedFlex(input: {
  projectTitle: string;
  projectsUrl: string;
}): LineFlexMessage {
  return {
    type: "flex",
    altText: `選考結果のお知らせ: ${input.projectTitle}`,
    contents: bubble([
      {
        type: "text",
        text: "選考結果のお知らせ",
        size: "sm",
        color: "#888888"
      },
      {
        type: "text",
        text: input.projectTitle,
        size: "lg",
        weight: "bold",
        wrap: true
      },
      {
        type: "text",
        text: "厳正な選考の結果、今回はご参加を見送らせていただくことになりました。またの応募をお待ちしています。",
        size: "sm",
        color: "#555555",
        wrap: true
      },
      {
        type: "separator"
      },
      {
        type: "button",
        action: {
          type: "uri",
          label: "ほかの案件をさがす",
          uri: input.projectsUrl
        },
        style: "secondary"
      }
    ])
  };
}
