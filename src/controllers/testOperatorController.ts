import type { Request, Response } from "express";
import { redirectWithError, redirectWithFlash } from "../lib/adminFlash";
import { respondentRepository } from "../repositories/respondentRepository";
import { testOperatorRepository } from "../repositories/testOperatorRepository";

/**
 * テスト運営者（migration 119）の管理画面。
 *
 * 管理画面の共通パスワードには個人の区別が無いので、運営者は LINE アカウントで指定する。
 * LINE userId を手で調べなくて済むよう、回答者を表示名で検索して選べるようにしている。
 *
 * adminController と別ファイルにしている理由: 既に 4,000 行を超えており、足すと差分が追えなくなる。
 */

const PATH = "/admin/test-operators";
const LINE_USER_ID_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;
const MAX_LABEL_LENGTH = 40;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const testOperatorController = {
  async index(req: Request, res: Response): Promise<void> {
    const q = stringValue(req.query.q);
    const [operators, search] = await Promise.all([
      testOperatorRepository.list(),
      q ? respondentRepository.searchPaged({ q, limit: 50, offset: 0 }) : Promise.resolve(null)
    ]);

    // respondents は案件ごとに1行なので、同じ人が案件の数だけ並ぶ。LINE アカウント単位にまとめる。
    const registered = new Set(operators.map((operator) => operator.line_user_id));
    const candidates = new Map<string, { line_user_id: string; display_name: string | null; registered: boolean }>();
    for (const row of search?.rows ?? []) {
      if (candidates.has(row.line_user_id)) continue;
      candidates.set(row.line_user_id, {
        line_user_id: row.line_user_id,
        display_name: row.display_name,
        registered: registered.has(row.line_user_id)
      });
    }

    res.render("admin/test-operators/index", {
      title: "テスト運営者",
      operators,
      q,
      candidates: [...candidates.values()]
    });
  },

  async create(req: Request, res: Response): Promise<void> {
    const lineUserId = stringValue(req.body.line_user_id);
    const label = stringValue(req.body.label);
    if (!LINE_USER_ID_PATTERN.test(lineUserId)) {
      redirectWithError(res, PATH, "LINE userId の形式が正しくありません。");
      return;
    }
    if (!label || label.length > MAX_LABEL_LENGTH) {
      redirectWithError(res, PATH, `呼び名は1〜${MAX_LABEL_LENGTH}文字で入力してください。`);
      return;
    }

    await testOperatorRepository.upsert({ line_user_id: lineUserId, label });
    // これまでの回答もテスト扱いにする（登録前に試した回答が集計に残らないように）。
    await respondentRepository.markTestByLineUserId(lineUserId);
    redirectWithFlash(res, PATH, `${label} をテスト運営者に登録しました。これまでの回答もテスト扱いになります。`);
  },

  async remove(req: Request, res: Response): Promise<void> {
    const lineUserId = stringValue(req.body.line_user_id);
    if (!LINE_USER_ID_PATTERN.test(lineUserId)) {
      redirectWithError(res, PATH, "LINE userId の形式が正しくありません。");
      return;
    }
    await testOperatorRepository.remove(lineUserId);
    redirectWithFlash(
      res,
      PATH,
      "テスト運営者から外しました。これまでの回答はテスト扱いのまま残ります。"
    );
  }
};
