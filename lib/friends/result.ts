// =====================================================================
// result.ts — データ層の戻り値とエラー変換（B7 / B9 共通）
//
// friends と friend_relationships で同じ形を使う。
// エラーは ValidationErrors 1本に集約しているので、画面側は
// 「入力ミス」と「DBのエラー」を同じコンポーネントで表示できる。
// =====================================================================

import { isUuid, type ValidationErrors } from './validation';

export type Failure = {
  ok: false;
  errors: ValidationErrors;
  /** 存在しない、または他人のデータ。「見つかりません」表示に使う */
  notFound?: true;
};

export type Result<T> = { ok: true; data: T } | Failure;

/** フォーム全体へのメッセージ1件だけを持つ失敗を作る */
export function failure(message: string, notFound?: true): Failure {
  const errors: ValidationErrors = { form: [message], fields: {}, attributes: {} };
  return notFound === true ? { ok: false, errors, notFound } : { ok: false, errors };
}

/**
 * id が uuid でなければ notFound を返す（問い合わせる前に弾く）。
 * uuid でない文字列をそのまま送ると Postgres が 22P02 を返し、画面が500になる。
 * /friends/abc のような URL 直打ちは「見つかりません」が正しい挙動。
 */
export function requireUuid(id: string, label = '対象'): Failure | null {
  return isUuid(id) ? null : failure(`指定された${label}が見つかりません。`, true);
}

/**
 * PostgREST / Postgres のエラーを、そのまま画面に出せる日本語に変える。
 * コードの意味は 0001_init.sql の制約と対応している。
 */
export function fromDatabaseError(error: { code?: string; message: string }): Failure {
  switch (error.code) {
    // check 制約。DB側の最後の砦に当たった＝アプリ側の検証をすり抜けた入力
    case '23514':
      if (error.message.includes('name_required')) {
        return failure('本名かニックネームのどちらかは入力してください。');
      }
      if (error.message.includes('no_self_relationship')) {
        return failure('同じ人どうしの関係は登録できません。');
      }
      return failure('入力内容が条件を満たしていません。');

    // 一意制約。関係性の重複（同じ2人・同じ関係タイプ）
    case '23505':
      return failure('同じ内容がすでに登録されています。');

    // 外部キー違反。参照先の友達が削除済み
    case '23503':
      return failure('対象の友達が見つかりません。すでに削除された可能性があります。');

    // not null 違反。owner_id が入らない＝auth.uid() が null＝ログインが切れている
    case '23502':
      return failure('ログインの有効期限が切れています。もう一度ログインしてください。');

    // RLS で拒否された
    case '42501':
      return failure('このデータを操作する権限がありません。');

    // uuid や date の形式違い
    case '22P02':
      return failure('指定されたデータが見つかりません。', true);

    // JWT 切れ
    case 'PGRST301':
      return failure('ログインの有効期限が切れています。もう一度ログインしてください。');

    default:
      // 想定外はサーバーログに残す（画面には詳細だけ添える）
      console.error('[friends] 予期しないDBエラー', error);
      return failure(`保存できませんでした。（詳細: ${error.message}）`);
  }
}
