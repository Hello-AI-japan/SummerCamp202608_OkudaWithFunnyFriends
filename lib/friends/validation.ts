// =====================================================================
// validation.ts — 友達データのバリデーション（B8）
//
// B7（CRUD / Server Actions）から呼ぶ純粋関数。
// Supabase にも Next.js にも依存しないので、Server Action からでも
// クライアントコンポーネント（入力中のリアルタイム表示）からでも同じものが使える。
//
// DBの制約（0001_init.sql）との役割分担：
//   ・DB側  … 壊れたデータを絶対に入れない最後の砦（name_required など）
//   ・こちら … ユーザーに「何が悪いのか」を日本語で伝える係
// こちらを作ったからといってDB側の制約は外さないこと。RLSと同じで、
// 最後の砦はDBに置く（フロント側の検証はいくらでも回避できる）。
//
// なぜ zod を使わないか：依存を増やさずに済み、自由項目の「行ごとのエラー」を
// そのままフォームに返せるため。行の追加/削除があるフォームだと、
// zod でも flatten を自前で組み替えることになり手間はほぼ同じになる。
//
// 呼び出し側からは tsconfig の paths（"@/*": ["./*"]）に合わせて
// `import { ... } from '@/lib/friends/validation'` で読む。
// =====================================================================

/** 自由項目フォームの1行。A5 のフォームが行ごとに持つ状態と同じ形 */
export type AttributeRow = { key: string; value: string };

/** 固定項目のフィールド名（エラーの宛先に使う） */
export type FixedField =
  | 'real_name'
  | 'nickname'
  | 'hometown'
  | 'birthdate'
  | 'phone_number';

/** フォームから来る生の値。未入力は '' / null / undefined のどれでもよい */
export type FriendFormInput = {
  real_name?: string | null;
  nickname?: string | null;
  hometown?: string | null;
  birthdate?: string | null;
  phone_number?: string | null;
  /** 自由項目（SNSもここに入れる ← 決定①） */
  attributes?: AttributeRow[] | null;
};

/**
 * friends テーブルにそのまま insert / update できる形。
 * owner_id は含めない（DBの default auth.uid() に任せる ← スキーマ変更1）。
 */
export type FriendPayload = {
  real_name: string | null;
  nickname: string | null;
  hometown: string | null;
  birthdate: string | null;
  phone_number: string | null;
  attributes: Record<string, string>;
};

export type ValidationErrors = {
  /** フォーム全体に出すメッセージ（例：本名とニックネームが両方空） */
  form: string[];
  /** 固定項目ごとのメッセージ */
  fields: Partial<Record<FixedField, string[]>>;
  /** 自由項目のメッセージ。キーは「入力時の行インデックス」なので、その行の下に出せる */
  attributes: Record<number, string[]>;
};

export type ValidationResult =
  | { ok: true; data: FriendPayload }
  | { ok: false; errors: ValidationErrors };

/** 上限値。UI側（maxLength 属性など）でも同じ値を使えるよう export している */
export const LIMITS = {
  /** 本名・ニックネーム・出身地・電話番号の文字数上限 */
  TEXT_MAX: 100,
  /** 自由項目の項目名の文字数上限 */
  ATTRIBUTE_KEY_MAX: 50,
  /** 自由項目の値の文字数上限 */
  ATTRIBUTE_VALUE_MAX: 500,
  /** 自由項目の行数上限（jsonb が無限に膨らむのを防ぐ） */
  ATTRIBUTE_ROWS_MAX: 20,
  /** 生年月日の下限。打ち間違い（例: 0202-01-01）の検出用 */
  BIRTHDATE_MIN_YEAR: 1900,
} as const;

const FIXED_FIELD_LABELS: Record<FixedField, string> = {
  real_name: '本名',
  nickname: 'ニックネーム',
  hometown: '出身地',
  birthdate: '生年月日',
  phone_number: '電話番号',
};

// ---------------------------------------------------------------------
// 小さなヘルパー
// ---------------------------------------------------------------------

/**
 * 前後の空白を落として、空なら null にする。
 * これが無いと空欄送信で '' が入り、DBの
 * `real_name is not null or nickname is not null` を '' がすり抜ける
 * （'' は not null なので制約上は合格してしまう）。
 */
function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** YYYY-MM-DD が実在する日付かどうか。2026-02-31 のような値をここで弾く */
function isRealCalendarDate(iso: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // 2026-02-31 は 2026-03-03 に繰り上がるので、戻して一致するかで判定する
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** 基準日を YYYY-MM-DD にする。文字列同士の比較で未来判定ができる */
function toIsoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------

/**
 * 入力を検証し、通れば friends に渡せる形（FriendPayload）を返す。
 * 通らなければ「どこに何を表示すればよいか」が分かる形でエラーを返す。
 *
 * 新規登録（A5）も編集（A7）も同じ関数を通す。編集でも全項目が送られてくるため、
 * 部分更新用の別ロジックは用意していない。
 *
 * @param input フォームの生の値
 * @param now   未来日付の判定基準。省略時は現在時刻（テストから固定できるよう引数にしている）
 */
export function validateFriendInput(
  input: FriendFormInput,
  now: Date = new Date(),
): ValidationResult {
  const errors: ValidationErrors = { form: [], fields: {}, attributes: {} };

  const addFieldError = (field: FixedField, message: string): void => {
    const list = errors.fields[field] ?? [];
    list.push(message);
    errors.fields[field] = list;
  };
  const addRowError = (index: number, message: string): void => {
    const list = errors.attributes[index] ?? [];
    list.push(message);
    errors.attributes[index] = list;
  };

  // --- 固定項目 ---------------------------------------------------
  const real_name = trimToNull(input.real_name);
  const nickname = trimToNull(input.nickname);
  const hometown = trimToNull(input.hometown);
  const birthdate = trimToNull(input.birthdate);
  const phone_number = trimToNull(input.phone_number);

  // 本名・ニックネームのどちらか必須（DBの name_required と同じ条件）
  if (real_name === null && nickname === null) {
    errors.form.push('本名かニックネームのどちらかは入力してください。');
    addFieldError('real_name', 'どちらかを入力してください。');
    addFieldError('nickname', 'どちらかを入力してください。');
  }

  // 文字数
  const textFields: Array<[FixedField, string | null]> = [
    ['real_name', real_name],
    ['nickname', nickname],
    ['hometown', hometown],
    ['phone_number', phone_number],
  ];
  for (const [field, value] of textFields) {
    if (value !== null && value.length > LIMITS.TEXT_MAX) {
      addFieldError(
        field,
        `${FIXED_FIELD_LABELS[field]}は${LIMITS.TEXT_MAX}文字以内で入力してください。`,
      );
    }
  }

  // 生年月日
  if (birthdate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      addFieldError('birthdate', '生年月日は YYYY-MM-DD の形式で入力してください。');
    } else if (!isRealCalendarDate(birthdate)) {
      addFieldError('birthdate', '存在しない日付です。');
    } else if (birthdate > toIsoDate(now)) {
      addFieldError('birthdate', '生年月日に未来の日付は指定できません。');
    } else if (Number(birthdate.slice(0, 4)) < LIMITS.BIRTHDATE_MIN_YEAR) {
      addFieldError(
        'birthdate',
        `生年月日は${LIMITS.BIRTHDATE_MIN_YEAR}年以降で入力してください。`,
      );
    }
  }

  // 電話番号。国番号や区切り方はいろいろあるので形式は緩く、桁数だけ常識の範囲に収める
  if (phone_number !== null) {
    if (!/^[0-9+\-()\s]+$/.test(phone_number)) {
      addFieldError(
        'phone_number',
        '電話番号は数字・ハイフン・+・()・空白のみで入力してください。',
      );
    } else {
      const digits = phone_number.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        addFieldError('phone_number', '電話番号の桁数が正しくありません（8〜15桁）。');
      }
    }
  }

  // --- 自由項目 ---------------------------------------------------
  // ここでやること：
  //   1. 何も入っていない行を除外する（＋を押して放置した行を {"":""} にしない）
  //   2. 値だけの行はエラーにする（黙って捨てると入力が消えたように見える）
  //   3. 項目名の重複をエラーにする（jsonb はオブジェクトなので後の行が前を上書きする）
  const rows = Array.isArray(input.attributes) ? input.attributes : [];
  const attributes: Record<string, string> = {};
  const firstRowOfKey = new Map<string, number>();
  let keptRows = 0;

  rows.forEach((row, index) => {
    const key = trimToNull(row?.key);
    // 値は trim するが空文字は許容する（項目名だけ入れて値は後で埋める、という使い方を潰さない）
    const value = typeof row?.value === 'string' ? row.value.trim() : '';

    // 1. 完全に空の行は除外（エラーにしない）
    if (key === null && value === '') return;

    // 2. 項目名が無い行
    if (key === null) {
      addRowError(index, '項目名を入力してください。');
      return;
    }

    if (key.length > LIMITS.ATTRIBUTE_KEY_MAX) {
      addRowError(index, `項目名は${LIMITS.ATTRIBUTE_KEY_MAX}文字以内で入力してください。`);
      return;
    }
    if (value.length > LIMITS.ATTRIBUTE_VALUE_MAX) {
      addRowError(index, `値は${LIMITS.ATTRIBUTE_VALUE_MAX}文字以内で入力してください。`);
      return;
    }

    // 3. 項目名の重複
    const firstRow = firstRowOfKey.get(key);
    if (firstRow !== undefined) {
      addRowError(index, `項目名「${key}」が${firstRow + 1}行目と重複しています。`);
      return;
    }
    firstRowOfKey.set(key, index);

    keptRows += 1;
    if (keptRows > LIMITS.ATTRIBUTE_ROWS_MAX) {
      addRowError(index, `自由項目は${LIMITS.ATTRIBUTE_ROWS_MAX}行までです。`);
      return;
    }

    attributes[key] = value;
  });

  if (hasErrors(errors)) return { ok: false, errors };

  return {
    ok: true,
    data: { real_name, nickname, hometown, birthdate, phone_number, attributes },
  };
}

/** エラーが1つでもあるか */
export function hasErrors(errors: ValidationErrors): boolean {
  return (
    errors.form.length > 0 ||
    Object.keys(errors.fields).length > 0 ||
    Object.keys(errors.attributes).length > 0
  );
}

/**
 * 全エラーを1行ずつの文字列にする。
 * 項目ごとの表示を作り込む前でも、これを並べれば「エラーメッセージが出る」状態になる。
 */
export function formatErrors(errors: ValidationErrors): string[] {
  const lines: string[] = [...errors.form];
  for (const [field, messages] of Object.entries(errors.fields)) {
    for (const message of messages ?? []) {
      lines.push(`${FIXED_FIELD_LABELS[field as FixedField]}：${message}`);
    }
  }
  for (const [index, messages] of Object.entries(errors.attributes)) {
    for (const message of messages) {
      lines.push(`自由項目${Number(index) + 1}行目：${message}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------
// フォームとの受け渡し（A5 / A7 用）
// ---------------------------------------------------------------------

/**
 * 自由項目の input に付ける name。
 * 行ごとに index を振らず、同じ name を並べるのがコツ。
 * FormData.getAll() は DOM の並び順を保つので、行を途中で削除しても
 * index の振り直しが要らない（＝Aのフォーム実装が軽くなる）。
 *
 *   <input name="attribute_key"   defaultValue={row.key} />
 *   <input name="attribute_value" defaultValue={row.value} />
 */
export const ATTRIBUTE_KEY_FIELD = 'attribute_key';
export const ATTRIBUTE_VALUE_FIELD = 'attribute_value';

/** Server Action に渡ってきた FormData を FriendFormInput に変換する */
export function parseFriendFormData(formData: FormData): FriendFormInput {
  const text = (name: string): string => {
    const value = formData.get(name);
    return typeof value === 'string' ? value : '';
  };
  const list = (name: string): string[] =>
    formData.getAll(name).map((value) => (typeof value === 'string' ? value : ''));

  const keys = list(ATTRIBUTE_KEY_FIELD);
  const values = list(ATTRIBUTE_VALUE_FIELD);
  const rowCount = Math.max(keys.length, values.length);
  const attributes: AttributeRow[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    attributes.push({ key: keys[i] ?? '', value: values[i] ?? '' });
  }

  return {
    real_name: text('real_name'),
    nickname: text('nickname'),
    hometown: text('hometown'),
    birthdate: text('birthdate'),
    phone_number: text('phone_number'),
    attributes,
  };
}

/**
 * DBの attributes（jsonb）を編集フォームの行に戻す（A7 の初期表示用）。
 * 値が文字列以外（数値・真偽値）で入っていても表示できるよう文字列化しておく。
 */
export function attributesToRows(
  attributes: Record<string, unknown> | null | undefined,
): AttributeRow[] {
  if (attributes === null || attributes === undefined || typeof attributes !== 'object') {
    return [];
  }
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value: value === null || value === undefined ? '' : String(value),
  }));
}
