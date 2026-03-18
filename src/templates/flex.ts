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
      text: "「はじめる」で開始、「再開」で続きから再開、「マイページ」でランクとポイントを確認できます。"
    }
  ];
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

export function buildRankUpMessages(newRankName: string): LineMessage[] {
  return [
    {
      type: "text",
      text: `ランクアップしました。現在のランクは ${newRankName} です。`
    }
  ];
}
