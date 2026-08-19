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

import {
  failure,
  fromDatabaseError,
  requireUuid,
  type Result,
} from './result';
import type { Friend, FriendAttributes } from './types';
import { validateFriendInput, type FriendFormInput } from './validation';

// 画面側が import 元を1つで済ませられるよう、戻り値の型はここからも出す
export type { Failure, Result } from './result';

const TABLE = 'friends';

/** 一覧・詳細で取り出す列。* だと将来列が増えたときに気づけないので明示する */
const COLUMNS =
  'id, owner_id, real_name, nickname, hometown, birthdate, phone_number, attributes, created_at, updated_at';

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
  const rejected = requireUuid(id, '友達');
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
  const rejected = requireUuid(id, '友達');
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
  const rejected = requireUuid(id, '友達');
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
