"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createFriend } from "@/lib/friends/repository";
import {
  ATTRIBUTE_KEY_FIELD,
  ATTRIBUTE_VALUE_FIELD,
  LIMITS,
  parseFriendFormData,
  type ValidationErrors,
} from "@/lib/friends/validation";

const EMPTY_ERRORS: ValidationErrors = { form: [], fields: {}, attributes: {} };

type AttributeRow = {
  id: string;
  key: string;
  value: string;
};

function createAttributeRow(): AttributeRow {
  return { id: crypto.randomUUID(), key: "", value: "" };
}

export default function NewFriendPage() {
  const [rows, setRows] = useState<AttributeRow[]>([]);
  const [errors, setErrors] = useState<ValidationErrors>(EMPTY_ERRORS);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  function addRow() {
    setRows((current) => [...current, createAttributeRow()]);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function updateRow(id: string, key: "key" | "value", value: string) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrors(EMPTY_ERRORS);

    const formData = new FormData(event.currentTarget);
    const input = parseFriendFormData(formData);

    const supabase = createClient();
    const result = await createFriend(supabase, input);

    if (!result.ok) {
      setErrors(result.errors);
      setSubmitting(false);
      return;
    }

    router.push(`/friends/${result.data.id}`);
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto flex max-w-lg flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">友達を新規登録</h1>
          <Link className="text-sm font-medium underline" href="/friends">
            一覧に戻る
          </Link>
        </div>

        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          {errors.form.length > 0 ? (
            <div className="flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-600">
              {errors.form.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="real_name">
                本名
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="real_name"
                maxLength={LIMITS.TEXT_MAX}
                name="real_name"
                type="text"
              />
              {errors.fields.real_name?.map((message) => (
                <p className="text-sm text-red-600" key={message}>
                  {message}
                </p>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="nickname">
                ニックネーム
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="nickname"
                maxLength={LIMITS.TEXT_MAX}
                name="nickname"
                type="text"
              />
              {errors.fields.nickname?.map((message) => (
                <p className="text-sm text-red-600" key={message}>
                  {message}
                </p>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="hometown">
                出身地
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="hometown"
                maxLength={LIMITS.TEXT_MAX}
                name="hometown"
                type="text"
              />
              {errors.fields.hometown?.map((message) => (
                <p className="text-sm text-red-600" key={message}>
                  {message}
                </p>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="birthdate">
                生年月日
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="birthdate"
                name="birthdate"
                type="date"
              />
              {errors.fields.birthdate?.map((message) => (
                <p className="text-sm text-red-600" key={message}>
                  {message}
                </p>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="phone_number">
                電話番号
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="phone_number"
                maxLength={LIMITS.TEXT_MAX}
                name="phone_number"
                type="tel"
              />
              {errors.fields.phone_number?.map((message) => (
                <p className="text-sm text-red-600" key={message}>
                  {message}
                </p>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">自由項目</h2>

            {rows.map((row, index) => (
              <div className="flex flex-col gap-1" key={row.id}>
                <div className="flex items-start gap-2">
                  <input
                    aria-label="項目名"
                    className="w-1/3 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    maxLength={LIMITS.ATTRIBUTE_KEY_MAX}
                    name={ATTRIBUTE_KEY_FIELD}
                    onChange={(event) => updateRow(row.id, "key", event.target.value)}
                    placeholder="項目名"
                    type="text"
                    value={row.key}
                  />
                  <input
                    aria-label="値"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                    maxLength={LIMITS.ATTRIBUTE_VALUE_MAX}
                    name={ATTRIBUTE_VALUE_FIELD}
                    onChange={(event) => updateRow(row.id, "value", event.target.value)}
                    placeholder="値"
                    type="text"
                    value={row.value}
                  />
                  <button
                    aria-label="この項目を削除"
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100"
                    onClick={() => removeRow(row.id)}
                    type="button"
                  >
                    削除
                  </button>
                </div>
                {errors.attributes[index]?.map((message) => (
                  <p className="text-sm text-red-600" key={message}>
                    {message}
                  </p>
                ))}
              </div>
            ))}

            <button
              className="self-start rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100"
              onClick={addRow}
              type="button"
            >
              ＋項目を追加
            </button>
          </div>

          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={submitting}
            type="submit"
          >
            {submitting ? "登録中..." : "登録する"}
          </button>
        </form>
      </section>
    </main>
  );
}
