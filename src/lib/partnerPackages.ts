import type { QuestionOption } from "../types/domain";
import type { PartnerQuestionType } from "./partnerQuestions";

/**
 * partnerPackages.ts
 *
 * パートナーAPI `GET /api/partner/packages` が返す業種別パッケージのマスタ。
 *
 * ai-chat-interview 側にパッケージ用テーブルは存在しないため（設問テンプレは
 * 管理画面の案件コピーで運用されてきた）、実装計画の「C3 パッケージ参照（マスタはW側）」
 * に従い、ここをマスタの唯一の正とする。追加・変更はこのファイルの編集で行う。
 *
 * 注意: 設問テンプレは「ポータルが下書きの初期値として使う雛形」であり、
 * POST /api/partner/surveys は questions を明示的に受け取る。サーバーが package_id から
 * 勝手に設問を差し込むことはしない（ポータル側の編集結果が唯一の正になるようにする）。
 * 性年代設問だけは例外で、常にサーバーが自動付与する。
 */

/** パッケージに含まれる設問テンプレ 1 件。 */
export interface PartnerPackageQuestion {
  question_text: string;
  question_type: PartnerQuestionType;
  answer_options: QuestionOption[] | null;
  sort_order: number;
  is_required: boolean;
}

/** 業種別パッケージ 1 件。 */
export interface PartnerPackage {
  /** 安定 ID。ポータル側の保存値になるため変更しない。 */
  id: string;
  /** 業種コード。 */
  industry: string;
  /** 業種の表示名。 */
  industry_label: string;
  name: string;
  description: string;
  /** このパッケージでアンケートを1本回すのに消費するチケット枚数（QR発行時の消費）。 */
  ticket_cost: number;
  questions: PartnerPackageQuestion[];
}

function scaleOptions(): QuestionOption[] {
  return [
    { value: "5", label: "とても満足" },
    { value: "4", label: "やや満足" },
    { value: "3", label: "ふつう" },
    { value: "2", label: "やや不満" },
    { value: "1", label: "とても不満" }
  ];
}

function knownChannelOptions(): QuestionOption[] {
  return [
    { value: "walk_by", label: "通りがかり" },
    { value: "sns", label: "SNS" },
    { value: "search", label: "検索・地図アプリ" },
    { value: "referral", label: "知人の紹介" },
    { value: "repeat", label: "以前から利用している" },
    { value: "other", label: "その他", allow_free_text: true }
  ];
}

function revisitOptions(): QuestionOption[] {
  return [
    { value: "5", label: "必ず利用したい" },
    { value: "4", label: "たぶん利用したい" },
    { value: "3", label: "どちらともいえない" },
    { value: "2", label: "あまり利用したくない" },
    { value: "1", label: "利用したくない" }
  ];
}

/**
 * パッケージ一覧。ticket_cost は「QR発行1回＝1枚」を基準に、
 * 設問数が多く分析量が増えるものを 2 枚としている。
 */
export const PARTNER_PACKAGES: readonly PartnerPackage[] = [
  {
    id: "restaurant_basic",
    industry: "restaurant",
    industry_label: "飲食店",
    name: "飲食店 基本セット",
    description: "満足度・再来店意向・認知経路を押さえた定番構成。初回の来店者アンケートに。",
    ticket_cost: 1,
    questions: [
      {
        question_text: "本日のご利用の総合的な満足度を教えてください。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 1,
        is_required: true
      },
      {
        question_text: "料理の味について、当てはまるものを選んでください。",
        question_type: "single_choice",
        answer_options: scaleOptions(),
        sort_order: 2,
        is_required: true
      },
      {
        question_text: "当店を知ったきっかけを教えてください。",
        question_type: "single_choice",
        answer_options: knownChannelOptions(),
        sort_order: 3,
        is_required: true
      },
      {
        question_text: "本日ご注文いただいたものを教えてください（複数選択可）。",
        question_type: "multi_choice",
        answer_options: [
          { value: "main", label: "メイン料理" },
          { value: "side", label: "サイドメニュー" },
          { value: "dessert", label: "デザート" },
          { value: "drink", label: "ドリンク" },
          { value: "other", label: "その他", allow_free_text: true }
        ],
        sort_order: 4,
        is_required: false
      },
      {
        question_text: "また利用したいと思いますか。",
        question_type: "scale",
        answer_options: revisitOptions(),
        sort_order: 5,
        is_required: true
      },
      {
        question_text: "改善してほしい点があれば自由にお書きください。",
        question_type: "free_text",
        answer_options: null,
        sort_order: 6,
        is_required: false
      }
    ]
  },
  {
    id: "salon_basic",
    industry: "salon",
    industry_label: "美容・サロン",
    name: "美容・サロン 基本セット",
    description: "施術満足度・接客・次回予約意向を測る構成。リピート率の改善検討に。",
    ticket_cost: 1,
    questions: [
      {
        question_text: "本日の施術の満足度を教えてください。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 1,
        is_required: true
      },
      {
        question_text: "スタッフの接客はいかがでしたか。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 2,
        is_required: true
      },
      {
        question_text: "当店を選んだ理由を教えてください（複数選択可）。",
        question_type: "multi_choice",
        answer_options: [
          { value: "price", label: "価格" },
          { value: "location", label: "立地・通いやすさ" },
          { value: "skill", label: "技術力" },
          { value: "atmosphere", label: "店内の雰囲気" },
          { value: "referral", label: "知人の紹介" },
          { value: "other", label: "その他", allow_free_text: true }
        ],
        sort_order: 3,
        is_required: true
      },
      {
        question_text: "次回も当店を利用したいと思いますか。",
        question_type: "scale",
        answer_options: revisitOptions(),
        sort_order: 4,
        is_required: true
      },
      {
        question_text: "今後受けてみたいメニューや、ご要望があればお書きください。",
        question_type: "free_text",
        answer_options: null,
        sort_order: 5,
        is_required: false
      }
    ]
  },
  {
    id: "retail_basic",
    industry: "retail",
    industry_label: "小売店",
    name: "小売店 基本セット",
    description: "品揃え・価格感・売場のわかりやすさを測る構成。棚替えや品揃え見直しの前に。",
    ticket_cost: 1,
    questions: [
      {
        question_text: "本日のお買い物の満足度を教えてください。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 1,
        is_required: true
      },
      {
        question_text: "品揃えについて、当てはまるものを選んでください。",
        question_type: "single_choice",
        answer_options: [
          { value: "enough", label: "十分だった" },
          { value: "somewhat", label: "やや物足りない" },
          { value: "not_enough", label: "物足りない" },
          { value: "not_found", label: "欲しいものが無かった" }
        ],
        sort_order: 2,
        is_required: true
      },
      {
        question_text: "価格についてどう感じましたか。",
        question_type: "single_choice",
        answer_options: [
          { value: "cheap", label: "安いと感じた" },
          { value: "reasonable", label: "妥当だと感じた" },
          { value: "expensive", label: "高いと感じた" }
        ],
        sort_order: 3,
        is_required: true
      },
      {
        question_text: "当店を知ったきっかけを教えてください。",
        question_type: "single_choice",
        answer_options: knownChannelOptions(),
        sort_order: 4,
        is_required: true
      },
      {
        question_text: "また利用したいと思いますか。",
        question_type: "scale",
        answer_options: revisitOptions(),
        sort_order: 5,
        is_required: true
      },
      {
        question_text: "取り扱ってほしい商品やご要望があればお書きください。",
        question_type: "free_text",
        answer_options: null,
        sort_order: 6,
        is_required: false
      }
    ]
  },
  {
    id: "clinic_basic",
    industry: "clinic",
    industry_label: "クリニック・治療院",
    name: "クリニック・治療院 基本セット",
    description: "待ち時間・説明のわかりやすさ・再来院意向を測る構成。運営改善の起点に。",
    ticket_cost: 1,
    questions: [
      {
        question_text: "本日のご来院の総合的な満足度を教えてください。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 1,
        is_required: true
      },
      {
        question_text: "待ち時間についてどう感じましたか。",
        question_type: "single_choice",
        answer_options: [
          { value: "short", label: "短かった" },
          { value: "acceptable", label: "気にならなかった" },
          { value: "long", label: "やや長かった" },
          { value: "too_long", label: "長すぎた" }
        ],
        sort_order: 2,
        is_required: true
      },
      {
        question_text: "説明のわかりやすさを教えてください。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 3,
        is_required: true
      },
      {
        question_text: "また利用したいと思いますか。",
        question_type: "scale",
        answer_options: revisitOptions(),
        sort_order: 4,
        is_required: true
      },
      {
        question_text: "改善してほしい点があれば自由にお書きください。",
        question_type: "free_text",
        answer_options: null,
        sort_order: 5,
        is_required: false
      }
    ]
  },
  {
    id: "general_basic",
    industry: "general",
    industry_label: "業種共通",
    name: "汎用 基本セット",
    description: "業種を問わず使える最小構成。まず試したいときに。",
    ticket_cost: 1,
    questions: [
      {
        question_text: "本日のご利用の総合的な満足度を教えてください。",
        question_type: "scale",
        answer_options: scaleOptions(),
        sort_order: 1,
        is_required: true
      },
      {
        question_text: "当店を知ったきっかけを教えてください。",
        question_type: "single_choice",
        answer_options: knownChannelOptions(),
        sort_order: 2,
        is_required: true
      },
      {
        question_text: "また利用したいと思いますか。",
        question_type: "scale",
        answer_options: revisitOptions(),
        sort_order: 3,
        is_required: true
      },
      {
        question_text: "ご意見・ご要望があれば自由にお書きください。",
        question_type: "free_text",
        answer_options: null,
        sort_order: 4,
        is_required: false
      }
    ]
  }
];

export function findPartnerPackage(packageId: string): PartnerPackage | null {
  return PARTNER_PACKAGES.find((entry) => entry.id === packageId) ?? null;
}
