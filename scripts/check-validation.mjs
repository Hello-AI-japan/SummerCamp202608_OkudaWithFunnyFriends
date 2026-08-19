// =====================================================================
// check-validation.mjs — B8 のバリデーションを検証する
//
// 使い方：
//   npm test
//   （中身は node --experimental-strip-types --test scripts/check-validation.mjs）
//
// npm install も Supabase への接続も要らない。
// validation.ts が import を1つも持たない純粋関数だけで出来ているため、
// 型を落とすだけで Node がそのまま実行できる。
//
// CI（C6）で回すには ci.yml の build の前に1行足す：
//   - run: npm test --if-present
//
// .mjs にしているのは、tsconfig の型チェック対象（.ts/.tsx）から外して
// `npm run build` を汚さないため。
// =====================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  ATTRIBUTE_KEY_FIELD,
  ATTRIBUTE_VALUE_FIELD,
  attributesToRows,
  formatErrors,
  parseFriendFormData,
  validateFriendInput,
} from '../lib/friends/validation.ts';

// 未来日付の判定がテスト実行日に左右されないよう、基準日を固定する
const NOW = new Date('2026-08-19T00:00:00Z');

/** 検証を通し、通ることを前提に payload を取り出す */
function expectOk(input) {
  const result = validateFriendInput(input, NOW);
  assert.equal(result.ok, true, `通るはずが弾かれた: ${JSON.stringify(result.errors)}`);
  return result.data;
}

/** 検証を通し、弾かれることを前提に errors を取り出す */
function expectNg(input) {
  const result = validateFriendInput(input, NOW);
  assert.equal(result.ok, false, '弾かれるはずが通った');
  return result.errors;
}

// ---------------------------------------------------------------------
// 1. 本名/ニックネームのどちらか必須（B8の完了条件）
// ---------------------------------------------------------------------

test('本名・ニックネームが両方空だとエラーメッセージが出る', () => {
  const errors = expectNg({ real_name: '', nickname: '' });
  assert.deepEqual(errors.form, ['本名かニックネームのどちらかは入力してください。']);
  // 両方の入力欄の下にも出せるようになっている
  assert.ok(errors.fields.real_name?.length);
  assert.ok(errors.fields.nickname?.length);
  // 表示を作り込む前でも、これを並べればメッセージが出る
  assert.ok(formatErrors(errors).length > 0);
});

test('空白だけの入力は「入力なし」として扱う（半角・全角とも）', () => {
  expectNg({ real_name: '   ', nickname: '　　' });
});

test('項目が未送信（undefined）でもエラーになる', () => {
  expectNg({});
});

test('ニックネームだけでも登録できる', () => {
  const data = expectOk({ nickname: 'テスト太郎' });
  assert.equal(data.nickname, 'テスト太郎');
  assert.equal(data.real_name, null);
});

test('本名だけでも登録できる', () => {
  const data = expectOk({ real_name: '架空 太郎' });
  assert.equal(data.nickname, null);
});

test('前後の空白は落ちる。空欄は null になる（DBの name_required を素通りさせない）', () => {
  const data = expectOk({ nickname: '  テスト太郎  ', hometown: '' });
  assert.equal(data.nickname, 'テスト太郎');
  assert.equal(data.hometown, null);
  assert.equal(data.birthdate, null);
  assert.equal(data.phone_number, null);
});

// ---------------------------------------------------------------------
// 2. 空の自由項目行を除外（B8の完了条件）
// ---------------------------------------------------------------------

test('空の自由項目行は除外される', () => {
  const data = expectOk({
    nickname: 'テスト太郎',
    attributes: [
      { key: '好きな食べ物', value: 'カレー' },
      { key: '', value: '' }, // ＋を押して放置した行
      { key: '  ', value: '  ' }, // 空白だけの行
      { key: 'X（Twitter）', value: '@example' },
    ],
  });
  assert.deepEqual(data.attributes, {
    好きな食べ物: 'カレー',
    'X（Twitter）': '@example',
  });
});

test('自由項目が0行なら空のオブジェクトになる（jsonb default と同じ形）', () => {
  const data = expectOk({ nickname: 'テスト太郎', attributes: [] });
  assert.deepEqual(data.attributes, {});
});

test('自由項目が未送信でも落ちない', () => {
  const data = expectOk({ nickname: 'テスト太郎' });
  assert.deepEqual(data.attributes, {});
});

test('値だけ入っている行は黙って捨てずにエラーにする', () => {
  const errors = expectNg({
    nickname: 'テスト太郎',
    attributes: [
      { key: '好きな食べ物', value: 'カレー' },
      { key: '', value: '項目名を書き忘れた値' },
    ],
  });
  // 2行目（index 1）の下に出せる
  assert.deepEqual(errors.attributes[1], ['項目名を入力してください。']);
  assert.equal(errors.attributes[0], undefined);
});

test('項目名だけの行は許容する（値は後から埋められる）', () => {
  const data = expectOk({
    nickname: 'テスト太郎',
    attributes: [{ key: '出会った場所', value: '' }],
  });
  assert.deepEqual(data.attributes, { 出会った場所: '' });
});

test('項目名の重複はエラー（jsonbだと後の行が前を上書きしてしまう）', () => {
  const errors = expectNg({
    nickname: 'テスト太郎',
    attributes: [
      { key: '趣味', value: '登山' },
      { key: '趣味', value: '将棋' },
    ],
  });
  assert.match(errors.attributes[1][0], /重複/);
});

test('項目名・値の文字数上限', () => {
  const tooLongKey = 'あ'.repeat(LIMITS.ATTRIBUTE_KEY_MAX + 1);
  const tooLongValue = 'い'.repeat(LIMITS.ATTRIBUTE_VALUE_MAX + 1);
  assert.ok(expectNg({ nickname: 'x', attributes: [{ key: tooLongKey, value: 'a' }] }).attributes[0]);
  assert.ok(expectNg({ nickname: 'x', attributes: [{ key: 'a', value: tooLongValue }] }).attributes[0]);
});

test('自由項目の行数上限を超えるとエラー', () => {
  const rows = Array.from({ length: LIMITS.ATTRIBUTE_ROWS_MAX + 1 }, (_, i) => ({
    key: `項目${i}`,
    value: 'x',
  }));
  const errors = expectNg({ nickname: 'テスト太郎', attributes: rows });
  assert.ok(errors.attributes[LIMITS.ATTRIBUTE_ROWS_MAX]);
  // 上限ぴったりは通る
  expectOk({ nickname: 'テスト太郎', attributes: rows.slice(0, LIMITS.ATTRIBUTE_ROWS_MAX) });
});

// ---------------------------------------------------------------------
// 3. 固定項目のかたち
// ---------------------------------------------------------------------

test('生年月日：正しい日付は通る', () => {
  const data = expectOk({ nickname: 'テスト太郎', birthdate: '2000-02-29' });
  assert.equal(data.birthdate, '2000-02-29');
});

test('生年月日：存在しない日付は弾く（そのまま送るとDBが500を返す）', () => {
  assert.match(expectNg({ nickname: 'x', birthdate: '2026-02-31' }).fields.birthdate[0], /存在しない/);
});

test('生年月日：形式違いは弾く', () => {
  assert.ok(expectNg({ nickname: 'x', birthdate: '2000/01/01' }).fields.birthdate);
});

test('生年月日：未来の日付は弾く', () => {
  assert.match(expectNg({ nickname: 'x', birthdate: '2026-08-20' }).fields.birthdate[0], /未来/);
  // 基準日ちょうどは通る
  expectOk({ nickname: 'x', birthdate: '2026-08-19' });
});

test('生年月日：桁の打ち間違いを弾く', () => {
  assert.ok(expectNg({ nickname: 'x', birthdate: '0202-01-01' }).fields.birthdate);
});

test('電話番号：ダミー番号や国番号つきは通る', () => {
  expectOk({ nickname: 'x', phone_number: '090-0000-0000' });
  expectOk({ nickname: 'x', phone_number: '+81 90 0000 0000' });
  expectOk({ nickname: 'x', phone_number: '(03)0000-0000' });
});

test('電話番号：文字が混ざる・桁数がおかしいものは弾く', () => {
  assert.ok(expectNg({ nickname: 'x', phone_number: 'ぜんぜん電話番号じゃない' }).fields.phone_number);
  assert.ok(expectNg({ nickname: 'x', phone_number: '090-0000-0000 (自宅)' }).fields.phone_number);
  assert.ok(expectNg({ nickname: 'x', phone_number: '123' }).fields.phone_number);
});

test('固定項目の文字数上限', () => {
  const tooLong = 'あ'.repeat(LIMITS.TEXT_MAX + 1);
  assert.ok(expectNg({ real_name: tooLong }).fields.real_name);
  assert.ok(expectNg({ nickname: 'x', hometown: tooLong }).fields.hometown);
});

test('エラーは1回の検証でまとめて返る（1つ直すたびに再送させない）', () => {
  const errors = expectNg({
    real_name: '',
    nickname: '',
    birthdate: '2026-02-31',
    phone_number: '123',
    attributes: [{ key: '', value: 'a' }],
  });
  assert.ok(errors.form.length >= 1);
  assert.ok(errors.fields.birthdate && errors.fields.phone_number);
  assert.ok(errors.attributes[0]);
  assert.ok(formatErrors(errors).length >= 4);
});

// ---------------------------------------------------------------------
// 4. フォームとの受け渡し（A5 / A7 用）
// ---------------------------------------------------------------------

test('FormData から自由項目を行として取り出せる（並び順でペアになる）', () => {
  const formData = new FormData();
  formData.set('real_name', '架空 太郎');
  formData.set('nickname', 'タロ');
  formData.set('hometown', '架空県');
  formData.set('birthdate', '2000-01-01');
  formData.set('phone_number', '090-0000-0000');
  formData.append(ATTRIBUTE_KEY_FIELD, '好きな食べ物');
  formData.append(ATTRIBUTE_VALUE_FIELD, 'カレー');
  formData.append(ATTRIBUTE_KEY_FIELD, ''); // 追加して放置された行
  formData.append(ATTRIBUTE_VALUE_FIELD, '');

  const input = parseFriendFormData(formData);
  assert.deepEqual(input.attributes, [
    { key: '好きな食べ物', value: 'カレー' },
    { key: '', value: '' },
  ]);

  const data = expectOk(input);
  assert.equal(data.real_name, '架空 太郎');
  assert.deepEqual(data.attributes, { 好きな食べ物: 'カレー' });
});

test('FormData が空でも parse は落ちず、検証でエラーになる', () => {
  const input = parseFriendFormData(new FormData());
  expectNg(input);
});

test('attributes を編集フォームの行に戻せる（A7の初期表示）', () => {
  const rows = attributesToRows({ 好きな食べ物: 'カレー', 出会った場所: '' });
  assert.deepEqual(rows, [
    { key: '好きな食べ物', value: 'カレー' },
    { key: '出会った場所', value: '' },
  ]);
  // null / undefined でも落ちない
  assert.deepEqual(attributesToRows(null), []);
  assert.deepEqual(attributesToRows(undefined), []);
});

test('保存 → 読み戻し → 再保存で内容が変わらない', () => {
  const first = expectOk({
    nickname: 'テスト太郎',
    attributes: [{ key: '好きな食べ物', value: 'カレー' }],
  });
  const second = expectOk({ nickname: first.nickname, attributes: attributesToRows(first.attributes) });
  assert.deepEqual(second, first);
});
