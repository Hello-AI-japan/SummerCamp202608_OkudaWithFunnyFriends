// =====================================================================
// check-rls.mjs — RLSが本当に効いているかを検証する（B5）
//
// 使い方：
//   node scripts/check-rls.mjs <SUPABASE_URL> <PUBLISHABLE_KEY>
//
// 例：
//   node scripts/check-rls.mjs https://xxxx.supabase.co sb_publishable_xxxx
//
// アプリが使うのと同じREST API経由で検証するので、フロントエンドが未完成でも実行できる。
// テスト用ユーザーを2つ作るので、終わったら Authentication → Users から削除してよい。
// =====================================================================

const [, , URL_ARG, KEY_ARG] = process.argv;
const SUPABASE_URL = (URL_ARG || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = KEY_ARG || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !KEY) {
  console.error('使い方: node scripts/check-rls.mjs <SUPABASE_URL> <PUBLISHABLE_KEY>');
  process.exit(1);
}

// 通信エラー等をそのまま出すと読めないので、短いメッセージに変える
function bail(e) {
  console.error(`\nエラー: ${e?.message ?? e}`);
  if (String(e?.message).includes('fetch failed')) {
    console.error('URLが正しいか、プロジェクトが一時停止していないか（STATUS が Healthy か）を確認してください。');
  }
  process.exit(1);
}
process.on('unhandledRejection', bail);
process.on('uncaughtException', bail);

// 毎回ユーザー名が衝突しないよう、実行時刻を混ぜる
const stamp = Date.now();
const USER_A = { email: `rlstest-a-${stamp}@example.com`, password: 'test-password-1234' };
const USER_B = { email: `rlstest-b-${stamp}@example.com`, password: 'test-password-1234' };

let passed = 0, failed = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

async function signUp(user) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`サインアップ失敗 (${res.status}): ${JSON.stringify(body)}`);
  if (!body.access_token) {
    throw new Error(
      'access_token が返りませんでした。Authentication → Sign In / Providers → Email の\n' +
      '「Confirm email」がオンになっている可能性があります（B4参照）。オフにして再実行してください。'
    );
  }
  return body.access_token;
}

// PostgREST への共通リクエスト
function api(path, token, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

console.log(`\n対象: ${SUPABASE_URL}\n`);

console.log('[準備] テスト用ユーザーを2つ作成');
const tokenA = await signUp(USER_A);
const tokenB = await signUp(USER_B);
console.log(`  ユーザーA: ${USER_A.email}`);
console.log(`  ユーザーB: ${USER_B.email}\n`);

console.log('[検証]');

// 1. owner_id を渡さなくても default auth.uid() で登録できるか
const insRes = await api('friends', tokenA, {
  method: 'POST',
  body: JSON.stringify({ nickname: 'テスト太郎', hometown: '架空県' }),
});
const inserted = await insRes.json();
check(
  'owner_idを省略してもAが登録できる（default auth.uid()）',
  insRes.ok && Array.isArray(inserted) && inserted.length === 1,
  insRes.ok ? '' : `HTTP ${insRes.status} ${JSON.stringify(inserted)}`
);
const rowId = inserted?.[0]?.id;

// 2. A から自分のデータが見えるか
const aRows = await (await api('friends?select=*', tokenA)).json();
check('Aは自分のデータが見える', Array.isArray(aRows) && aRows.length >= 1, `${aRows.length ?? '?'}件`);

// 3. B から A のデータが見えないか ← これが本命
const bRows = await (await api('friends?select=*', tokenB)).json();
check('BからAのデータが見えない', Array.isArray(bRows) && bRows.length === 0,
  `Bから見えた件数: ${Array.isArray(bRows) ? bRows.length : JSON.stringify(bRows)}`);

// 4. B が A の owner_id を詐称して挿入できないか（with check の検証）
const aOwnerId = aRows?.[0]?.owner_id;
const spoof = await api('friends', tokenB, {
  method: 'POST',
  body: JSON.stringify({ nickname: 'なりすまし', owner_id: aOwnerId }),
});
check('Bはowner_idを詐称して挿入できない', spoof.status === 403 || spoof.status === 401,
  `HTTP ${spoof.status}`);

// 5. B が A の行を id 直指定で更新・削除できないか
const upd = await api(`friends?id=eq.${rowId}`, tokenB, {
  method: 'PATCH',
  body: JSON.stringify({ nickname: '書き換え' }),
});
const updBody = await upd.json().catch(() => []);
check('BはAの行をid直指定でも更新できない',
  !upd.ok || (Array.isArray(updBody) && updBody.length === 0),
  `HTTP ${upd.status} / 更新された行数: ${Array.isArray(updBody) ? updBody.length : '?'}`);

// 後片付け（Aの行を消す）
if (rowId) await api(`friends?id=eq.${rowId}`, tokenA, { method: 'DELETE' });

console.log(`\n結果: ${passed} 件成功 / ${failed} 件失敗`);
if (failed > 0) {
  console.log('\n失敗がある場合、RLSポリシーが正しく適用されていません。');
  console.log('0001_init.sql の「4. Row Level Security」の部分を再実行してください。');
  console.log('特に with check を書き忘れると、検証4だけが失敗します。');
  process.exit(1);
}
console.log('\nRLSは正しく効いています。テストユーザーは Authentication → Users から削除できます。');
