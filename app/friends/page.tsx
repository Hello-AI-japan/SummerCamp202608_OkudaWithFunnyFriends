import Link from "next/link";
import { getFriends } from "@/lib/friends/repository";

export default async function FriendsPage() {
  const friends = await getFriends();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">友達一覧</h1>
          <Link
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            href="/friends/new"
          >
            ＋新規登録
          </Link>
        </div>

        {friends.length === 0 ? (
          <p className="text-sm text-slate-600">まだ友達が登録されていません</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {friends.map((friend) => (
              <Link
                className="rounded-lg border border-slate-200 bg-white p-5 hover:bg-slate-50"
                href={`/friends/${friend.id}`}
                key={friend.id}
              >
                <h2 className="font-semibold">{friend.nickname || friend.real_name}</h2>
                <p className="mt-2 text-sm text-slate-600">{friend.hometown}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
