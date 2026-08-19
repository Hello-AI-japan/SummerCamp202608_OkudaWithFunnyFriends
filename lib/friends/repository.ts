// =====================================================================
// repository.ts — friends の CRUD（B7）
//
// 設計：Supabase クライアントを引数で受け取る。
//   ・Server Component からは  lib/supabase/server  の createClient()
//   ・Client Component からは  lib/supabase/client  の createClient()
// どちらを渡しても同じ関数が使える。
//
// なぜ Server Actions に閉じ込めないか：
// 雛形が Next.js 本体ではなく vinext（Vite + RSC）で、"use server" の挙動が
// 確実でないため。呼び出し側を後から Server Actions に寄せても、この層は変えずに済む。
// 認証は A さんの実装に合わせてクライアント側で完結しているので、そこにも合う。
//
// 戻り値はすべて Result<T>。エラーは ValidationErrors 1本に集約しているので、
// 画面側は「入力ミス」と「DBのエラー」を同じ形で表示できる（表示コードが1つで済む）。
//
// RLS があるので owner_id は一切送らない（DBの default auth.uid() に任せる）。
// where owner_id = ... も書かない（RLS が勝手に付ける）。
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Friend, FriendAttributes } from './types';
import {
  validateFriendInput,
  type FriendFormInput,
  type ValidationErrors,
} from './validation';

const TABLE = 'friends';

/** 一覧・詳細で取り出す列。* だと将来列が増えたときに気づけないので明示する */
const COLUMNS =
  'id, owner_id, real_name, nickname, hometown, birthdate, phone_number, attributes, created_at, updated_at';

export type Failure = {
  ok: false;
  errors: ValidationErrors;
  /** 存在しない、または他人のデータ。詳細画面の「見つかりません」表示に使う */
  notFound?: true;
};

export type Result<T> = { ok: true; data: T } | Failure;

// ---------------------------------------------------------------------
// エラーの組み立て
// ---------------------------------------------------------------------

/** フォーム全体へのメッセージ1件だけを持つ失敗を作る */
function failure(message: string, notFound?: true): Failure {
  const errors: ValidationErrors = { form: [message], fields: {}, attributes: {} };
  return notFound === true ? { ok: false, errors, notFound } : { ok: false, errors };
}

/** PostgREST のエラーを、そのまま画面に出せる日本語に変える */
function fromDatabaseError(error: { code?: string; message: string }): Failure {
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

    // uuid や date の形式違い。URL を直打ちされた場合など
    case '22P02':
      return failure('指定されたデータが見つかりません。', true);

    // JWT 切れ
    case 'PGRST301':
      return failure('ログインの有効期限が切れています。もう一度ログインしてください。');

    default:
      // 想定外はサーバーログに残す（画面には出さない）
      console.error('[friends] 予期しないDBエラー', error);
      return failure(`保存できませんでした。（詳細: ${error.message}）`);
  }
}

// ---------------------------------------------------------------------
// 行 → Friend への変換
// ---------------------------------------------------------------------

/**
 * jsonb は数値や null も入り得るので、表示側が String 変換を意識しないよう
 * ここで文字列に揃える。attributes が null の行があっても {} にする。
 */
function normalizeAttributes(value: unknown): FriendAttributes {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const attributes: FriendAttributes = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    attributes[key] = raw === null || raw === undefined ? '' : String(raw);
  }
  return attributes;
}

function toFriend(row: Record<string, unknown>): Friend {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    real_name: (row.real_name as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    hometown: (row.hometown as string | null) ?? null,
    birthdate: (row.birthdate as string | null) ?? null,
    phone_number: (row.phone_number as string | null) ?? null,
    attributes: normalizeAttributes(row.attributes),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * uuid でない id は問い合わせる前に弾く。
 * そのまま送ると Postgres が 22P02 を返し、画面が500になってしまう。
 * 「見つかりません」として扱うのが正しい（/friends/abc を直打ちされた場合）。
 */
function invalidId(id: string): Failure | null {
  return UUID_PATTERN.test(id) ? null : failure('指定された友達が見つかりません。', true);
}

// ---------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------

/**
 * 一覧（A4）。RLS があるので自分のデータしか返らない。
 * 0件は成功（data: []）。「まだ登録がありません」の表示は画面側で出す。
 */
export async function listFriends(supabase: SupabaseClient): Promise<Result<Friend[]>> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order('created_at', { ascending: false });

  if (error) return fromDatabaseError(error);
  return { ok: true, data: (data ?? []).map(toFriend) };
}

/**
 * 1件取得（A6）。
 * 他人のデータは RLS により0件で返るため、存在しない場合と同じ notFound になる
 * （「他人のデータが存在すること」自体を隠せる）。
 */
export async function getFriend(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<Friend>> {
  const rejected = invalidId(id);
  if (rejected) return rejected;

  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) return fromDatabaseError(error);
  if (!data) return failure('指定された友達が見つかりません。', true);
  return { ok: true, data: toFriend(data) };
}

/**
 * 新規登録（A5）。
 * FormData から呼ぶ場合は parseFriendFormData() を通してから渡す。
 * owner_id は渡さない（DBの default auth.uid() が入れる）。
 */
export async function createFriend(
  supabase: SupabaseClient,
  input: FriendFormInput,
): Promise<Result<Friend>> {
  const validated = validateFriendInput(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(validated.data)
    .select(COLUMNS)
    .single();

  if (error) return fromDatabaseError(error);
  return { ok: true, data: toFriend(data) };
}

/**
 * 更新（A7）。フォームは全項目を送ってくるので、部分更新はしない。
 * updated_at はここで入れる。DBにトリガーが無いため、任せると作成時のまま止まる。
 */
export async function updateFriend(
  supabase: SupabaseClient,
  id: string,
  input: FriendFormInput,
): Promise<Result<Friend>> {
  const rejected = invalidId(id);
  if (rejected) return rejected;

  const validated = validateFriendInput(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...validated.data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) return fromDatabaseError(error);
  // 0件更新は「自分のデータではない」か「すでに消えている」
  if (!data) return failure('指定された友達が見つかりません。', true);
  return { ok: true, data: toFriend(data) };
}

/**
 * 削除（A8）。関係性（friend_relationships）は on delete cascade で一緒に消える。
 * 消した行を返させることで、「本当に消えたのか」を呼び出し側で判定できる。
 */
export async function deleteFriend(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<null>> {
  const rejected = invalidId(id);
  if (rejected) return rejected;

  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return fromDatabaseError(error);
  if (!data) return failure('指定された友達が見つかりません。', true);
  return { ok: true, data: null };
}
