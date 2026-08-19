"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const router = useRouter();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // メール確認が有効な場合はセッションが発行されないため、案内を表示する
    if (!data.session) {
      setConfirmationSent(true);
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (confirmationSent) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
        <section className="mx-auto flex max-w-sm flex-col gap-4">
          <h1 className="text-2xl font-semibold">確認メールを送信しました</h1>
          <p className="text-sm text-slate-600">
            {email} 宛に確認メールを送信しました。メール内のリンクからアカウントを有効化してください。
          </p>
          <Link className="font-medium underline" href="/login">
            ログインページへ戻る
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto flex max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">サインアップ</h1>
          <p className="text-sm text-slate-600">
            すでにアカウントをお持ちの場合は{" "}
            <Link className="font-medium underline" href="/login">
              ログイン
            </Link>
          </p>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="email">
              メールアドレス
            </label>
            <input
              autoComplete="email"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="password">
              パスワード
            </label>
            <input
              autoComplete="new-password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              id="password"
              minLength={6}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "登録中..." : "サインアップ"}
          </button>
        </form>
      </section>
    </main>
  );
}
