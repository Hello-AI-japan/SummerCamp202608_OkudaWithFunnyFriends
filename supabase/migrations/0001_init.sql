-- =====================================================================
-- 0001_init.sql — 友達情報管理アプリの初期スキーマ（B2 / B3）
--
-- 実行方法：Supabase ダッシュボード → SQL Editor に貼って Run。
-- 上から下まで一度に実行できる（PostgreSQL 16 で検証済み）。
--
-- 適用したあとは、必ずアプリ側の経路で RLS を確認する：
--   npm run check:rls -- <SUPABASE_URL> <PUBLISHABLE_KEY>
--
-- SQL Editor で select して確認してはいけない。SQL Editor は postgres ロールで
-- 実行され、テーブル所有者は RLS をバイパスするため全行見えてしまう。
-- 「RLS が効いていない」と誤解するか、確認したつもりで何も確認できていない状態になる。
--
-- 計画書からの変更点（検証して必要だと分かった2点）：
--   変更1: owner_id に default auth.uid() を付けた
--          INSERT 時に渡し忘れて RLS ポリシー違反で弾かれる事故を防ぐ。
--   変更2: 関係性の一意インデックスを作り直した
--          計画書の定義だと同じ2人の間に2種類の関係を登録できず
--          （「同じサークル」と「先輩後輩」が共存できない）、
--          is_directional = true でも逆向きを登録できなかった。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. friends — 友達本体
--    固定項目に入らないものは attributes（jsonb）に入れる。SNSもここ（決定①）。
-- ---------------------------------------------------------------------
create table friends (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) default auth.uid(),  -- ★変更1
  real_name     text,
  nickname      text,
  hometown      text,
  birthdate     date,
  phone_number  text,
  attributes    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 本名とニックネームの両方が空の行は作れない。
  -- アプリ側（lib/friends/validation.ts）で空文字を null に落としているので、
  -- '' で素通りすることはない（'' は not null なので、落とさないとすり抜ける）。
  constraint name_required check (real_name is not null or nickname is not null)
);

-- 一覧は必ず owner_id で絞られる（RLS が付ける条件も含む）ので、ここに索引を張る
create index idx_friends_owner_id on friends(owner_id);

-- 自由項目での検索を将来的に効かせるため
create index idx_friends_attributes on friends using gin (attributes);


-- ---------------------------------------------------------------------
-- 2. friend_relationships — 友達どうしの関係（Should 機能）
--    friends を削除したら、その友達が絡む関係も一緒に消える（cascade）。
-- ---------------------------------------------------------------------
create table friend_relationships (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) default auth.uid(),  -- ★変更1
  friend_a_id        uuid not null references friends(id) on delete cascade,
  friend_b_id        uuid not null references friends(id) on delete cascade,
  relationship_type  text not null,
  note               text,
  -- 向きのある関係（先輩→後輩など）は true。同期・同じサークルなどは false。
  is_directional     boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint no_self_relationship check (friend_a_id <> friend_b_id)
);


-- ---------------------------------------------------------------------
-- 3. 関係の重複防止（★変更2）
--    関係タイプごとに1件だけ許す。
--    無向は (a,b) の順序を正規化して同一視し、有向は向きを区別する。
-- ---------------------------------------------------------------------
create unique index idx_unique_relationship_undirected
  on friend_relationships (owner_id, least(friend_a_id, friend_b_id), greatest(friend_a_id, friend_b_id), relationship_type)
  where not is_directional;

create unique index idx_unique_relationship_directed
  on friend_relationships (owner_id, friend_a_id, friend_b_id, relationship_type)
  where is_directional;


-- ---------------------------------------------------------------------
-- 4. Row Level Security
--    自分が登録したデータにしか触れないようにする。
--    using  … select / update / delete で見える行を絞る
--    with check … insert / update で書き込める行を絞る（他人の owner_id を詐称できなくする）
--    with check を書き忘れると、他人の owner_id を指定した insert が通ってしまう。
-- ---------------------------------------------------------------------
alter table friends enable row level security;
alter table friend_relationships enable row level security;

create policy "own friends only" on friends
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "own relationships only" on friend_relationships
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());


-- =====================================================================
-- 検証済みの挙動（scripts/check-rls.mjs と PostgreSQL 16 で確認）
--   ・owner_id を省略すると auth.uid() が入る
--   ・他ユーザーのデータは select で0件になる
--   ・他人の owner_id を詐称した insert は with check で弾かれる
--   ・本名・ニックネーム両方が空の登録は name_required で弾かれる
--   ・自分自身との関係は no_self_relationship で弾かれる
--   ・friend を削除すると関係もカスケード削除される
--   ・least/greatest を使った式インデックスが作れる
-- =====================================================================
