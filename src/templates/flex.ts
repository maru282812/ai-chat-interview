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

export function buildRankUpMessages(newRankName: string): LineMessage[] {
  return [
    {
      type: "text",
      text: `ランクアップしました。現在のランクは ${newRankName} です。`
    }
  ];
}
