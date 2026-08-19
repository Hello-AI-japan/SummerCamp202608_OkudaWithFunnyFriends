"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createFriend } from "@/lib/friends/repository";

type CustomField = {
  id: string;
  label: string;
  value: string;
};

function createCustomField(): CustomField {
  return { id: crypto.randomUUID(), label: "", value: "" };
}

export default function NewFriendPage() {
  const [realName, setRealName] = useState("");
  const [nickname, setNickname] = useState("");
  const [hometown, setHometown] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function addCustomField() {
    setCustomFields((fields) => [...fields, createCustomField()]);
  }

  function removeCustomField(id: string) {
    setCustomFields((fields) => fields.filter((field) => field.id !== id));
  }

  function updateCustomField(id: string, key: "label" | "value", value: string) {
    setCustomFields((fields) =>
      fields.map((field) => (field.id === id ? { ...field, [key]: value } : field)),
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const friend = await createFriend({
        real_name: realName,
        nickname,
        hometown,
        birthdate,
        phone_number: phoneNumber,
        attributes: customFields.map(({ label, value }) => ({ label, value })),
      });
      router.push(`/friends/${friend.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
      setSubmitting(false);
    }
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="real_name">
                本名
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="real_name"
                onChange={(event) => setRealName(event.target.value)}
                required
                type="text"
                value={realName}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="nickname">
                ニックネーム
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="nickname"
                onChange={(event) => setNickname(event.target.value)}
                type="text"
                value={nickname}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="hometown">
                出身地
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="hometown"
                onChange={(event) => setHometown(event.target.value)}
                type="text"
                value={hometown}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="birthdate">
                生年月日
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="birthdate"
                onChange={(event) => setBirthdate(event.target.value)}
                type="date"
                value={birthdate}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="phone_number">
                電話番号
              </label>
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                id="phone_number"
                onChange={(event) => setPhoneNumber(event.target.value)}
                type="tel"
                value={phoneNumber}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">自由項目</h2>

            {customFields.map((field) => (
              <div className="flex items-start gap-2" key={field.id}>
                <input
                  aria-label="項目名"
                  className="w-1/3 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  onChange={(event) => updateCustomField(field.id, "label", event.target.value)}
                  placeholder="項目名"
                  type="text"
                  value={field.label}
                />
                <input
                  aria-label="値"
                  className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  onChange={(event) => updateCustomField(field.id, "value", event.target.value)}
                  placeholder="値"
                  type="text"
                  value={field.value}
                />
                <button
                  aria-label="この項目を削除"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100"
                  onClick={() => removeCustomField(field.id)}
                  type="button"
                >
                  削除
                </button>
              </div>
            ))}

            <button
              className="self-start rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100"
              onClick={addCustomField}
              type="button"
            >
              ＋項目を追加
            </button>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

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
