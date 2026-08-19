// =====================================================================
// check-repository.mjs — friends の CRUD（B7）を検証する
//
// 使い方： npm test
//
// Supabase には繋がない。偽のクライアントを渡して
// 「どんなクエリを組み立てたか」「エラーをどう日本語に変えたか」を確認する。
// repository.ts が @supabase/supabase-js を型としてしか import していないので、
// 実行時には本物のクライアントが要らない（型は実行時に消える）。
//
// 本物のDBに対する確認は npm run check:rls と、アプリからの手動確認で行う。
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFriend,
  deleteFriend,
  getFriend,
  listFriends,
  updateFriend,
} from '../lib/friends/repository.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';

/** DBが返す1行のひな型 */
function row(overrides = {}) {
  return {
    id: ID,
    owner_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    real_name: null,
    nickname: 'テスト太郎',
    hometown: null,
    birthdate: null,
    phone_number: null,
    attributes: {},
    created_at: '2026-08-19T00:00:00Z',
    updated_at: '2026-08-19T00:00:00Z',
    ...overrides,
  };
}

/**
 * 偽の Supabase クライアント。
 * result に返させたい { data, error } を渡す。組み立てられたクエリは calls に残る。
 */
function fakeSupabase(result) {
  const calls = [];
  const builder = {
    select(columns) {
      calls.push(['select', columns]);
      return builder;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return builder;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return builder;
    },
    single() {
      calls.push(['single']);
      return Promise.resolve(result);
    },
    maybeSingle() {
      calls.push(['maybeSingle']);
      return Promise.resolve(result);
    },
    // await でそのまま解決できるようにする（一覧のように single を挟まない経路）
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };

  return {
    calls,
    /** calls から特定の操作を取り出す */
    call(name) {
      return calls.find(([called]) => called === name);
    },
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns) {
          calls.push(['select', columns]);
          return builder;
        },
        insert(payload) {
          calls.push(['insert', payload]);
          return builder;
        },
        update(payload) {
          calls.push(['update', payload]);
          return builder;
        },
        delete() {
          calls.push(['delete']);
          return builder;
        },
      };
    },
  };
}

const ok = (data) => ({ data, error: null });
const dbError = (code, message = 'db error') => ({ data: null, error: { code, message } });

// ---------------------------------------------------------------------
// 一覧（A4）
// ---------------------------------------------------------------------

test('一覧：新しい順に取得し、Friend に変換して返す', async () => {
  const supabase = fakeSupabase(ok([row(), row({ id: OTHER_ID, nickname: '架空花子' })]));
  const result = await listFriends(supabase);

  assert.equal(result.ok, true);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].nickname, 'テスト太郎');
  assert.deepEqual(supabase.call('from'), ['from', 'friends']);
  assert.deepEqual(supabase.call('order'), ['order', 'created_at', { ascending: false }]);
});

test('一覧：0件は成功として返す（画面側で「まだ登録がありません」を出す）', async () => {
  const result = await listFriends(fakeSupabase(ok([])));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

test('一覧：data が null でも落ちずに空配列になる', async () => {
  const result = await listFriends(fakeSupabase(ok(null)));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

test('一覧：owner_id で絞る条件は自分では付けない（RLSが付ける）', async () => {
  const supabase = fakeSupabase(ok([]));
  await listFriends(supabase);
  const ownerFilter = supabase.calls.find(([call, column]) => call === 'eq' && column === 'owner_id');
  assert.equal(ownerFilter, undefined);
});

// ---------------------------------------------------------------------
// 1件取得（A6）
// ---------------------------------------------------------------------

test('取得：見つかれば Friend を返す', async () => {
  const supabase = fakeSupabase(ok(row()));
  const result = await getFriend(supabase, ID);

  assert.equal(result.ok, true);
  assert.equal(result.data.id, ID);
  assert.deepEqual(supabase.call('eq'), ['eq', 'id', ID]);
});

test('取得：他人のデータ・存在しないデータは notFound（RLSにより0件で返る）', async () => {
  const result = await getFriend(fakeSupabase(ok(null)), OTHER_ID);
  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
  assert.ok(result.errors.form[0].includes('見つかりません'));
});

test('取得：uuid でない id は問い合わせずに notFound（そのまま送ると500になる）', async () => {
  const supabase = fakeSupabase(ok(row()));
  const result = await getFriend(supabase, 'not-a-uuid');

  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
  assert.equal(supabase.calls.length, 0, 'DBに問い合わせてはいけない');
});

test('取得：attributes の値が文字列以外でも文字列に揃える', async () => {
  const result = await getFriend(fakeSupabase(ok(row({ attributes: { 身長: 170, 既婚: false } }))), ID);
  assert.deepEqual(result.data.attributes, { 身長: '170', 既婚: 'false' });
});

test('取得：attributes が null の行でも {} になる', async () => {
  const result = await getFriend(fakeSupabase(ok(row({ attributes: null }))), ID);
  assert.deepEqual(result.data.attributes, {});
});

// ---------------------------------------------------------------------
// 登録（A5）
// ---------------------------------------------------------------------

test('登録：検証を通った値だけを insert する（空の自由項目行は落ちている）', async () => {
  const supabase = fakeSupabase(ok(row()));
  const result = await createFriend(supabase, {
    nickname: '  テスト太郎  ',
    hometown: '',
    attributes: [
      { key: '好きな食べ物', value: 'カレー' },
      { key: '', value: '' },
    ],
  });

  assert.equal(result.ok, true);
  const [, payload] = supabase.call('insert');
  assert.equal(payload.nickname, 'テスト太郎');
  assert.equal(payload.hometown, null);
  assert.deepEqual(payload.attributes, { 好きな食べ物: 'カレー' });
});

test('登録：owner_id は送らない（DBの default auth.uid() に任せる）', async () => {
  const supabase = fakeSupabase(ok(row()));
  await createFriend(supabase, { nickname: 'テスト太郎' });
  const [, payload] = supabase.call('insert');
  assert.equal('owner_id' in payload, false);
});

test('登録：入力が不正なときはDBに触らず、エラーだけ返す', async () => {
  const supabase = fakeSupabase(ok(row()));
  const result = await createFriend(supabase, { real_name: '', nickname: '' });

  assert.equal(result.ok, false);
  assert.equal(supabase.calls.length, 0, '検証前にDBへ行ってはいけない');
  assert.ok(result.errors.form.length > 0);
  assert.equal(result.notFound, undefined);
});

// ---------------------------------------------------------------------
// 更新（A7）
// ---------------------------------------------------------------------

test('更新：updated_at を一緒に送る（DBにトリガーが無いため）', async () => {
  const supabase = fakeSupabase(ok(row()));
  const before = Date.now();
  const result = await updateFriend(supabase, ID, { nickname: 'テスト太郎' });

  assert.equal(result.ok, true);
  const [, payload] = supabase.call('update');
  assert.ok(payload.updated_at, 'updated_at が入っていない');
  assert.ok(new Date(payload.updated_at).getTime() >= before);
  assert.deepEqual(supabase.call('eq'), ['eq', 'id', ID]);
});

test('更新：0件更新は notFound（他人のデータ、または削除済み）', async () => {
  const result = await updateFriend(fakeSupabase(ok(null)), ID, { nickname: 'テスト太郎' });
  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
});

test('更新：入力が不正なときはDBに触らない', async () => {
  const supabase = fakeSupabase(ok(row()));
  const result = await updateFriend(supabase, ID, { real_name: ' ', nickname: '' });
  assert.equal(result.ok, false);
  assert.equal(supabase.calls.length, 0);
});

// ---------------------------------------------------------------------
// 削除（A8）
// ---------------------------------------------------------------------

test('削除：消えた行が返れば成功', async () => {
  const supabase = fakeSupabase(ok({ id: ID }));
  const result = await deleteFriend(supabase, ID);

  assert.equal(result.ok, true);
  assert.ok(supabase.call('delete'));
  assert.deepEqual(supabase.call('eq'), ['eq', 'id', ID]);
});

test('削除：0件なら notFound（他人のデータを消したことにしない）', async () => {
  const result = await deleteFriend(fakeSupabase(ok(null)), ID);
  assert.equal(result.ok, false);
  assert.equal(result.notFound, true);
});

// ---------------------------------------------------------------------
// DBエラーの日本語化
// ---------------------------------------------------------------------

test('DBエラー：name_required 違反は必須項目のメッセージになる', async () => {
  const result = await createFriend(
    fakeSupabase(dbError('23514', 'new row violates check constraint "name_required"')),
    { nickname: 'テスト太郎' },
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.form[0].includes('本名かニックネーム'));
});

test('DBエラー：not null 違反（ログイン切れ）を案内する', async () => {
  const result = await createFriend(fakeSupabase(dbError('23502', 'null value in column "owner_id"')), {
    nickname: 'テスト太郎',
  });
  assert.ok(result.errors.form[0].includes('ログイン'));
});

test('DBエラー：RLS で拒否された場合は権限のメッセージになる', async () => {
  const result = await createFriend(fakeSupabase(dbError('42501', 'new row violates row-level security policy')), {
    nickname: 'テスト太郎',
  });
  assert.ok(result.errors.form[0].includes('権限'));
});

test('DBエラー：一意制約違反は重複のメッセージになる', async () => {
  const result = await createFriend(fakeSupabase(dbError('23505', 'duplicate key value')), {
    nickname: 'テスト太郎',
  });
  assert.ok(result.errors.form[0].includes('すでに登録'));
});

test('DBエラー：JWT 切れを案内する', async () => {
  const result = await listFriends(fakeSupabase(dbError('PGRST301', 'JWT expired')));
  assert.equal(result.ok, false);
  assert.ok(result.errors.form[0].includes('ログイン'));
});

test('DBエラー：想定外のコードでも画面に出せる形で返る', async () => {
  const supabase = fakeSupabase(dbError('XX000', 'internal error'));
  // 想定外は console.error に出す仕様なので、テスト中は黙らせる
  const original = console.error;
  console.error = () => {};
  try {
    const result = await listFriends(supabase);
    assert.equal(result.ok, false);
    assert.ok(result.errors.form.length === 1);
  } finally {
    console.error = original;
  }
});
