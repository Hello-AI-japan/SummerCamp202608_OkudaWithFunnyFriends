// =====================================================================
// check-relationships.mjs — 関係性の CRUD（B9）を検証する
//
// 使い方： npm test
//
// check-repository.mjs と同じく、偽のクライアントを渡して
// 組み立てたクエリと戻り値の形を確認する（Supabase には繋がない）。
// テーブルごとに別の結果を返せるようにしてあるので、
// 「関係を引いてから相手の名前を引く」2段構えの動きも確認できる。
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRelationship,
  deleteRelationship,
  describeRelationship,
  listRelationshipsForFriend,
  updateRelationship,
} from '../lib/friends/relationships.ts';
import { friendDisplayName } from '../lib/friends/types.ts';
import { parseRelationshipFormData } from '../lib/friends/validation.ts';

const ME = '11111111-1111-1111-1111-111111111111';
const PARTNER = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const REL_ID = '44444444-4444-4444-4444-444444444444';

function relationshipRow(overrides = {}) {
  return {
    id: REL_ID,
    owner_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '同じサークル',
    note: null,
    is_directional: false,
    created_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/** テーブルごとに返す結果を指定できる偽クライアント */
function fakeSupabase(resultsByTable) {
  const calls = [];
  const resultFor = (table) => resultsByTable[table] ?? { data: null, error: null };

  function builder(table) {
    const chain = {
      select(columns) {
        calls.push([table, 'select', columns]);
        return chain;
      },
      eq(column, value) {
        calls.push([table, 'eq', column, value]);
        return chain;
      },
      or(filter) {
        calls.push([table, 'or', filter]);
        return chain;
      },
      in(column, values) {
        calls.push([table, 'in', column, values]);
        return chain;
      },
      order(column, options) {
        calls.push([table, 'order', column, options]);
        return chain;
      },
      single() {
        return Promise.resolve(resultFor(table));
      },
      maybeSingle() {
        return Promise.resolve(resultFor(table));
      },
      then(resolve, reject) {
        return Promise.resolve(resultFor(table)).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    calls,
    /** calls から最初の一致を取り出す */
    call(table, name) {
      return calls.find(([calledTable, called]) => calledTable === table && called === name);
    },
    tables() {
      return [...new Set(calls.map(([table]) => table))];
    },
    from(table) {
      return {
        select(columns) {
          calls.push([table, 'select', columns]);
          return builder(table);
        },
        insert(payload) {
          calls.push([table, 'insert', payload]);
          return builder(table);
        },
        update(payload) {
          calls.push([table, 'update', payload]);
          return builder(table);
        },
        delete() {
          calls.push([table, 'delete']);
          return builder(table);
        },
      };
    },
  };
}

const ok = (data) => ({ data, error: null });
const dbError = (code, message = 'db error') => ({ data: null, error: { code, message } });

/** console.warn / console.error を黙らせて関数を実行する */
async function silently(run) {
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

// ---------------------------------------------------------------------
// 詳細画面用の取得（B9の完了条件）
// ---------------------------------------------------------------------

test('詳細用：相手の表示名つきで返る（自分が a 側でも b 側でも相手を取れる）', async () => {
  const supabase = fakeSupabase({
    friend_relationships: ok([
      relationshipRow(), // 自分が a 側 → 相手は PARTNER
      relationshipRow({ id: OTHER, friend_a_id: OTHER, friend_b_id: ME }), // 自分が b 側 → 相手は OTHER
    ]),
    friends: ok([
      { id: PARTNER, real_name: '架空 花子', nickname: 'ハナ' },
      { id: OTHER, real_name: null, nickname: 'サブロー' },
    ]),
  });

  const result = await listRelationshipsForFriend(supabase, ME);

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].partner.id, PARTNER);
  assert.equal(friendDisplayName(result.data[0].partner), 'ハナ');
  assert.equal(result.data[1].partner.id, OTHER);
  assert.equal(friendDisplayName(result.data[1].partner), 'サブロー');
});

test('詳細用：a 側 b 側の両方を拾う or フィルタを組む', async () => {
  const supabase = fakeSupabase({ friend_relationships: ok([]) });
  await listRelationshipsForFriend(supabase, ME);

  assert.deepEqual(supabase.call('friend_relationships', 'or'), [
    'friend_relationships',
    'or',
    `friend_a_id.eq.${ME},friend_b_id.eq.${ME}`,
  ]);
});

test('詳細用：相手の名前は1回のクエリでまとめて引く（重複した相手は1回だけ）', async () => {
  const supabase = fakeSupabase({
    friend_relationships: ok([
      relationshipRow(),
      relationshipRow({ id: OTHER, relationship_type: '同じ大学' }), // 同じ相手
    ]),
    friends: ok([{ id: PARTNER, real_name: '架空 花子', nickname: null }]),
  });

  const result = await listRelationshipsForFriend(supabase, ME);

  assert.equal(result.data.length, 2);
  const inCall = supabase.call('friends', 'in');
  assert.deepEqual(inCall[3], [PARTNER], '相手の id は重複を除いて渡す');
  const friendsQueries = supabase.calls.filter(([table]) => table === 'friends');
  assert.equal(friendsQueries.filter(([, call]) => call === 'in').length, 1);
});

test('詳細用：関係が0件なら friends を引かない', async () => {
  const supabase = fakeSupabase({ friend_relationships: ok([]) });
  const result = await listRelationshipsForFriend(supabase, ME);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
  assert.deepEqual(supabase.tables(), ['friend_relationships']);
});

test('詳細用：相手が見つからない関係は飛ばす（画面を壊さない）', async () => {
  const supabase = fakeSupabase({
    friend_relationships: ok([relationshipRow()]),
    friends: ok([]),
  });

  const result = await silently(() => listRelationshipsForFriend(supabase, ME));

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

test('詳細用：uuid でない id は問い合わせずに notFound', async () => {
  const supabase = fakeSupabase({});
  const result = await listRelationshipsForFriend(supabase, 'not-a-uuid');

  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
  assert.equal(supabase.calls.length, 0);
});

test('詳細用：新しい順に並べる', async () => {
  const supabase = fakeSupabase({ friend_relationships: ok([]) });
  await listRelationshipsForFriend(supabase, ME);
  assert.deepEqual(supabase.call('friend_relationships', 'order'), [
    'friend_relationships',
    'order',
    'created_at',
    { ascending: false },
  ]);
});

// ---------------------------------------------------------------------
// 登録
// ---------------------------------------------------------------------

test('登録：検証を通った値を insert する（owner_id は送らない）', async () => {
  const supabase = fakeSupabase({ friend_relationships: ok(relationshipRow()) });
  const result = await createRelationship(supabase, {
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '  同じサークル  ',
    note: '',
  });

  assert.equal(result.ok, true);
  const [, , payload] = supabase.call('friend_relationships', 'insert');
  assert.deepEqual(payload, {
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '同じサークル',
    note: null,
    is_directional: false,
  });
});

test('登録：同じ人どうしはDBに触らずエラー（no_self_relationship と同条件）', async () => {
  const supabase = fakeSupabase({});
  const result = await createRelationship(supabase, {
    friend_a_id: ME,
    friend_b_id: ME,
    relationship_type: '同じサークル',
  });

  assert.equal(result.ok, false);
  assert.equal(supabase.calls.length, 0);
  assert.ok(result.errors.form[0].includes('同じ人どうし'));
});

test('登録：友達が選ばれていないと項目ごとのエラーになる', async () => {
  const result = await createRelationship(fakeSupabase({}), { relationship_type: '同じ大学' });

  assert.equal(result.ok, false);
  assert.ok(result.errors.fields.friend_a_id);
  assert.ok(result.errors.fields.friend_b_id);
});

test('登録：関係が空だとエラー', async () => {
  const result = await createRelationship(fakeSupabase({}), {
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '   ',
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.fields.relationship_type);
});

test('登録：id が uuid でなければDBに触らない', async () => {
  const supabase = fakeSupabase({});
  const result = await createRelationship(supabase, {
    friend_a_id: 'not-a-uuid',
    friend_b_id: PARTNER,
    relationship_type: '同じ大学',
  });

  assert.equal(result.ok, false);
  assert.equal(supabase.calls.length, 0);
  assert.ok(result.errors.fields.friend_a_id);
});

test('登録：向きのある関係は is_directional が true で入る', async () => {
  const supabase = fakeSupabase({
    friend_relationships: ok(relationshipRow({ is_directional: true })),
  });
  const result = await createRelationship(supabase, {
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '先輩・後輩',
    is_directional: true,
  });

  assert.equal(result.ok, true);
  const [, , payload] = supabase.call('friend_relationships', 'insert');
  assert.equal(payload.is_directional, true);
  assert.equal(result.data.is_directional, true);
});

test('登録：重複は「すでに登録されています」になる（一意インデックス）', async () => {
  const result = await createRelationship(
    fakeSupabase({ friend_relationships: dbError('23505', 'duplicate key value') }),
    { friend_a_id: ME, friend_b_id: PARTNER, relationship_type: '同じサークル' },
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.form[0].includes('すでに登録'));
});

test('登録：削除済みの友達を指すと外部キー違反のメッセージになる', async () => {
  const result = await createRelationship(
    fakeSupabase({ friend_relationships: dbError('23503', 'foreign key violation') }),
    { friend_a_id: ME, friend_b_id: PARTNER, relationship_type: '同じサークル' },
  );

  assert.ok(result.errors.form[0].includes('見つかりません'));
});

// ---------------------------------------------------------------------
// 更新・削除
// ---------------------------------------------------------------------

test('更新：id で絞って更新する', async () => {
  const supabase = fakeSupabase({ friend_relationships: ok(relationshipRow({ note: 'メモ' })) });
  const result = await updateRelationship(supabase, REL_ID, {
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '同じサークル',
    note: 'メモ',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(supabase.call('friend_relationships', 'eq'), [
    'friend_relationships',
    'eq',
    'id',
    REL_ID,
  ]);
  assert.equal(result.data.note, 'メモ');
});

test('更新：0件なら notFound（他人の関係）', async () => {
  const result = await updateRelationship(fakeSupabase({ friend_relationships: ok(null) }), REL_ID, {
    friend_a_id: ME,
    friend_b_id: PARTNER,
    relationship_type: '同じサークル',
  });

  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
});

test('削除：消えた行が返れば成功', async () => {
  const supabase = fakeSupabase({ friend_relationships: ok({ id: REL_ID }) });
  const result = await deleteRelationship(supabase, REL_ID);

  assert.equal(result.ok, true);
  assert.ok(supabase.call('friend_relationships', 'delete'));
});

test('削除：0件なら notFound', async () => {
  const result = await deleteRelationship(fakeSupabase({ friend_relationships: ok(null) }), REL_ID);
  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
});

// ---------------------------------------------------------------------
// フォームと表示（C8 用）
// ---------------------------------------------------------------------

test('FormData：チェックボックスの有無で is_directional が決まる', () => {
  const base = new FormData();
  base.set('friend_a_id', ME);
  base.set('friend_b_id', PARTNER);
  base.set('relationship_type', '先輩・後輩');

  assert.equal(parseRelationshipFormData(base).is_directional, false);

  const checked = new FormData();
  checked.set('is_directional', 'on');
  assert.equal(parseRelationshipFormData(checked).is_directional, true);
});

test('FormData：そのまま createRelationship に渡せる', async () => {
  const formData = new FormData();
  formData.set('friend_a_id', ME);
  formData.set('friend_b_id', PARTNER);
  formData.set('relationship_type', '同じサークル');
  formData.set('note', ' 学部が同じ ');

  const supabase = fakeSupabase({ friend_relationships: ok(relationshipRow()) });
  const result = await createRelationship(supabase, parseRelationshipFormData(formData));

  assert.equal(result.ok, true);
  const [, , payload] = supabase.call('friend_relationships', 'insert');
  assert.equal(payload.note, '学部が同じ');
});

test('表示：向きのある関係は向きが分かる文になる', () => {
  const undirected = { ...relationshipRow(), partner: { id: PARTNER, real_name: null, nickname: 'ハナ' } };
  assert.equal(describeRelationship(undirected, ME), '同じサークル');

  const forward = { ...undirected, is_directional: true, relationship_type: '先輩・後輩' };
  assert.match(describeRelationship(forward, ME), /この友達 → 相手/);

  const backward = { ...forward, friend_a_id: PARTNER, friend_b_id: ME };
  assert.match(describeRelationship(backward, ME), /相手 → この友達/);
});
