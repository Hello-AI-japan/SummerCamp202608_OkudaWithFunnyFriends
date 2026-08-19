// =====================================================================
// types.ts — friends / friend_relationships の型（B6）
//
// supabase gen types で生成する代わりに手書きしている。
// 生成物は Database 型が巨大で読みにくく、CLI のセットアップ時間もかかるため、
// 2テーブルしか無いこの規模では手書きの方が速い。
// 定義元は supabase/migrations/0001_init.sql。あちらを変えたらここも変える。
//
// 日時・日付が string なのは、PostgREST が JSON で返す形（ISO 8601 文字列）に
// 合わせているため。Date に変換していないので、表示側で好きに整形できる。
// =====================================================================

/** 自由項目。jsonb の中身。値は常に文字列として扱う（フォームから来る形に合わせる） */
export type FriendAttributes = Record<string, string>;

/** friends テーブルの1行 */
export type Friend = {
  id: string;
  owner_id: string;
  real_name: string | null;
  nickname: string | null;
  hometown: string | null;
  birthdate: string | null;
  phone_number: string | null;
  attributes: FriendAttributes;
  created_at: string;
  updated_at: string;
};

/** friend_relationships テーブルの1行（B9 / C8 用） */
export type FriendRelationship = {
  id: string;
  owner_id: string;
  friend_a_id: string;
  friend_b_id: string;
  relationship_type: string;
  note: string | null;
  /** 向きのある関係（先輩→後輩など）なら true */
  is_directional: boolean;
  created_at: string;
};

/** 詳細画面で「誰との関係か」を出すために、相手の表示名を添えた形（B9 用） */
export type RelationshipWithPartner = FriendRelationship & {
  /** 表示の起点になっている友達から見た相手 */
  partner: Pick<Friend, 'id' | 'real_name' | 'nickname'>;
};

/**
 * 一覧・詳細に出す名前。
 * 本名とニックネームはどちらか片方だけでも登録できる（name_required）ので、
 * 表示する側で毎回 null を気にしないで済むようにここに寄せている。
 * 両方あるときはニックネームを主に出す（friends アプリなので呼び名が自然）。
 */
export function friendDisplayName(
  friend: Pick<Friend, 'real_name' | 'nickname'>,
): string {
  return friend.nickname ?? friend.real_name ?? '(名前未設定)';
}

/** 本名とニックネームの両方があるときだけ、補助的に出す文字列。無ければ null */
export function friendSubName(
  friend: Pick<Friend, 'real_name' | 'nickname'>,
): string | null {
  if (friend.nickname !== null && friend.real_name !== null) return friend.real_name;
  return null;
}
