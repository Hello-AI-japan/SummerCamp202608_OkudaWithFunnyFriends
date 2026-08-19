// =====================================================================
// relationships.ts — friend_relationships の CRUD と相手の表示名の取得（B9）
//
// repository.ts と同じ設計。Supabase クライアントを引数で受け取り、
// owner_id は送らず（default auth.uid()）、絞り込みも RLS に任せる。
//
// 詳細画面（A6）で「この友達は誰とどういう関係か」を出すために、
// 関係の相手側の表示名が必要になる。ここでは PostgREST の埋め込み
// （friends!friend_a_id(...) のような書き方）を使わず、
//   1回目: friend_relationships を取る
//   2回目: 出てきた相手の id をまとめて friends から取る
// の2回に分けている。
//
// 理由：friend_relationships は friends に対して2本の外部キーを持つため、
// 埋め込みの曖昧さ回避（ヒント指定）が要る。ヒント名を1文字間違えるだけで
// 実行時にしか分からないエラーになり、本番でだけ関係性が出ない事故になりやすい。
// 2回に分ければ普通の select だけで済み、件数も友達1人分なので速度も問題にならない。
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { failure, fromDatabaseError, requireUuid, type Result } from './result';
import type { Friend, FriendRelationship, RelationshipWithPartner } from './types';
import {
  validateRelationshipInput,
  type RelationshipFormInput,
} from './validation';

export type { Failure, Result } from './result';

const TABLE = 'friend_relationships';

const COLUMNS =
  'id, owner_id, friend_a_id, friend_b_id, relationship_type, note, is_directional, created_at';

/** 相手の表示に必要な列だけ */
const PARTNER_COLUMNS = 'id, real_name, nickname';

type PartnerRow = Pick<Friend, 'id' | 'real_name' | 'nickname'>;

function toRelationship(row: Record<string, unknown>): FriendRelationship {
  return {
    id: String(row.id),
    owner_id: String(row.owner_id),
    friend_a_id: String(row.friend_a_id),
    friend_b_id: String(row.friend_b_id),
    relationship_type: String(row.relationship_type),
    note: (row.note as string | null) ?? null,
    is_directional: row.is_directional === true,
    created_at: String(row.created_at),
  };
}

function toPartner(row: Record<string, unknown>): PartnerRow {
  return {
    id: String(row.id),
    real_name: (row.real_name as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------

/**
 * ある友達に紐づく関係を、相手の表示名つきで返す（A6 の詳細画面用）。
 *
 * friend_a_id / friend_b_id のどちらに入っていても拾う。
 * 返す partner は「起点の友達から見た相手」なので、画面側は
 * friendDisplayName(relationship.partner) を出すだけでよい。
 *
 * is_directional が true の関係は「friend_a → friend_b」の向きを持つ。
 * 起点が a 側なのか b 側なのかは friend_a_id === friendId で判定できる。
 */
export async function listRelationshipsForFriend(
  supabase: SupabaseClient,
  friendId: string,
): Promise<Result<RelationshipWithPartner[]>> {
  const rejected = requireUuid(friendId, '友達');
  if (rejected) return rejected;

  // friendId は uuid だと確認済みなので、フィルタ文字列に埋め込んでも安全
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .or(`friend_a_id.eq.${friendId},friend_b_id.eq.${friendId}`)
    .order('created_at', { ascending: false });

  if (error) return fromDatabaseError(error);

  const relationships = (data ?? []).map(toRelationship);
  if (relationships.length === 0) return { ok: true, data: [] };

  // 相手の id を集めて、まとめて1回で引く
  const partnerIds = [
    ...new Set(
      relationships.map((relationship) =>
        relationship.friend_a_id === friendId
          ? relationship.friend_b_id
          : relationship.friend_a_id,
      ),
    ),
  ];

  const { data: partnerRows, error: partnerError } = await supabase
    .from('friends')
    .select(PARTNER_COLUMNS)
    .in('id', partnerIds);

  if (partnerError) return fromDatabaseError(partnerError);

  const partners = new Map<string, PartnerRow>();
  for (const row of partnerRows ?? []) {
    const partner = toPartner(row);
    partners.set(partner.id, partner);
  }

  const withPartner: RelationshipWithPartner[] = [];
  for (const relationship of relationships) {
    const partnerId =
      relationship.friend_a_id === friendId
        ? relationship.friend_b_id
        : relationship.friend_a_id;
    const partner = partners.get(partnerId);
    if (!partner) {
      // cascade delete があるので通常は起きない。起きても画面を壊さず飛ばす
      console.warn('[friends] 関係の相手が見つかりません', {
        relationshipId: relationship.id,
        partnerId,
      });
      continue;
    }
    withPartner.push({ ...relationship, partner });
  }

  return { ok: true, data: withPartner };
}

// ---------------------------------------------------------------------
// 登録・更新・削除（C8 の登録UI用）
// ---------------------------------------------------------------------

/**
 * 関係を登録する。
 * 同じ2人・同じ関係タイプの重複は DB の一意インデックスが弾き、
 * 「同じ内容がすでに登録されています。」というメッセージになる。
 */
export async function createRelationship(
  supabase: SupabaseClient,
  input: RelationshipFormInput,
): Promise<Result<FriendRelationship>> {
  const validated = validateRelationshipInput(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const { data, error } = await supabase
    .from(TABLE)
    .insert(validated.data)
    .select(COLUMNS)
    .single();

  if (error) return fromDatabaseError(error);
  return { ok: true, data: toRelationship(data) };
}

/** 関係を更新する（関係の種類・メモ・向きの修正） */
export async function updateRelationship(
  supabase: SupabaseClient,
  id: string,
  input: RelationshipFormInput,
): Promise<Result<FriendRelationship>> {
  const rejected = requireUuid(id, '関係');
  if (rejected) return rejected;

  const validated = validateRelationshipInput(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const { data, error } = await supabase
    .from(TABLE)
    .update(validated.data)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();

  if (error) return fromDatabaseError(error);
  if (!data) return failure('指定された関係が見つかりません。', true);
  return { ok: true, data: toRelationship(data) };
}

/** 関係を削除する。友達自体は消えない */
export async function deleteRelationship(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<null>> {
  const rejected = requireUuid(id, '関係');
  if (rejected) return rejected;

  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return fromDatabaseError(error);
  if (!data) return failure('指定された関係が見つかりません。', true);
  return { ok: true, data: null };
}

/**
 * 関係の説明文を作る（画面での表示用）。
 * 向きのある関係は起点から見た向きが分かるようにする。
 *
 *   無向: 「同じサークル」
 *   有向（起点が a 側）: 「先輩・後輩（自分 → 相手）」
 *   有向（起点が b 側）: 「先輩・後輩（相手 → 自分）」
 */
export function describeRelationship(
  relationship: RelationshipWithPartner,
  friendId: string,
): string {
  if (!relationship.is_directional) return relationship.relationship_type;
  const forward = relationship.friend_a_id === friendId;
  return `${relationship.relationship_type}（${forward ? 'この友達 → 相手' : '相手 → この友達'}）`;
}
