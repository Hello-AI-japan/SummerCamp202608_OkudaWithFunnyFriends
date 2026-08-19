import Link from "next/link";
import { getFriendById } from "@/lib/friends/repository";

export default async function FriendDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const friend = await getFriendById(id);

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto flex max-w-lg flex-col gap-6">
        <Link className="text-sm font-medium underline" href="/friends">
          一覧に戻る
        </Link>

        {!friend ? (
          <p className="text-sm text-slate-600">見つかりません</p>
        ) : (
          <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-semibold">{friend.nickname || friend.real_name}</h1>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <dl className="flex flex-col gap-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    本名
                  </dt>
                  <dd className="mt-1 text-sm">{friend.real_name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    ニックネーム
                  </dt>
                  <dd className="mt-1 text-sm">{friend.nickname || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    出身地
                  </dt>
                  <dd className="mt-1 text-sm">{friend.hometown}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    生年月日
                  </dt>
                  <dd className="mt-1 text-sm">{friend.birthdate}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    電話番号
                  </dt>
                  <dd className="mt-1 text-sm">{friend.phone_number || "-"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                自由項目
              </h2>
              {friend.attributes.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">登録されていません</p>
              ) : (
                <dl className="mt-2 flex flex-col gap-3">
                  {friend.attributes.map((attribute, index) => (
                    <div key={`${attribute.label}-${index}`}>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {attribute.label}
                      </dt>
                      <dd className="mt-1 text-sm">{attribute.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
