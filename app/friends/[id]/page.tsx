"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getFriend, listFriends } from "@/lib/friends/repository";
import {
  createRelationship,
  describeRelationship,
  listRelationshipsForFriend,
} from "@/lib/friends/relationships";
import { friendDisplayName, type Friend, type RelationshipWithPartner } from "@/lib/friends/types";
import { LIMITS, parseRelationshipFormData, type ValidationErrors } from "@/lib/friends/validation";

const EMPTY_ERRORS: ValidationErrors = { form: [], fields: {}, attributes: {} };

export default function FriendDetailPage() {
  const params = useParams<{ id: string }>();
  const friendId = params?.id ?? "";

  const [friend, setFriend] = useState<Friend | null>(null);
  const [friendNotFound, setFriendNotFound] = useState(false);
  const [relationships, setRelationships] = useState<RelationshipWithPartner[]>([]);
  const [listErrors, setListErrors] = useState<string[]>([]);
  const [otherFriends, setOtherFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [modalErrors, setModalErrors] = useState<ValidationErrors>(EMPTY_ERRORS);
  const [modalNotFound, setModalNotFound] = useState(false);

  const loadFriendAndRelationships = useCallback(async () => {
    if (!friendId) return;
    setLoading(true);
    const supabase = createClient();

    const friendResult = await getFriend(supabase, friendId);
    if (!friendResult.ok) {
      setFriend(null);
      setFriendNotFound(true);
      setRelationships([]);
      setLoading(false);
      return;
    }
    setFriend(friendResult.data);
    setFriendNotFound(false);

    const relResult = await listRelationshipsForFriend(supabase, friendId);
    if (!relResult.ok) {
      setListErrors(relResult.errors.form.length > 0 ? relResult.errors.form : ["関係性の取得に失敗しました。"]);
      setRelationships([]);
    } else {
      setListErrors([]);
      setRelationships(relResult.data);
    }

    setLoading(false);
  }, [friendId]);

  const loadOtherFriends = useCallback(async () => {
    if (!friendId) return;
    const supabase = createClient();
    const result = await listFriends(supabase);
    if (result.ok) {
      setOtherFriends(result.data.filter((candidate) => candidate.id !== friendId));
    }
  }, [friendId]);

  useEffect(() => {
    loadFriendAndRelationships();
    loadOtherFriends();
  }, [loadFriendAndRelationships, loadOtherFriends]);

  function openModal() {
    setModalErrors(EMPTY_ERRORS);
    setModalNotFound(false);
    setIsModalOpen(true);
  }

  function closeModal() {
    if (submitting) return;
    setIsModalOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setModalErrors(EMPTY_ERRORS);
    setModalNotFound(false);

    const formData = new FormData(event.currentTarget);
    const input = parseRelationshipFormData(formData);

    const supabase = createClient();
    const result = await createRelationship(supabase, {
      friend_a_id: friendId,
      friend_b_id: input.friend_b_id,
      relationship_type: input.relationship_type,
      note: input.note,
      is_directional: input.is_directional,
    });

    if (!result.ok) {
      setModalErrors(result.errors);
      setModalNotFound(result.notFound === true);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setIsModalOpen(false);
    await loadFriendAndRelationships();
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
        <p className="text-sm text-slate-600">読み込み中...</p>
      </main>
    );
  }

  if (friendNotFound || !friend) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
        <section className="mx-auto flex max-w-2xl flex-col gap-4">
          <p className="text-sm text-red-600">対象の友達が見つかりません。</p>
          <Link className="text-sm font-medium underline" href="/friends">
            友達一覧へ戻る
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link className="text-sm font-medium underline" href="/friends">
            ← 友達一覧へ戻る
          </Link>
          <h1 className="text-2xl font-semibold">{friendDisplayName(friend)}</h1>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">関係性</h2>
          <button
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            onClick={openModal}
            type="button"
          >
            ＋関係性を追加
          </button>
        </div>

        {listErrors.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-600">
            {listErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}

        {relationships.length === 0 ? (
          <p className="text-sm text-slate-600">まだ関係性が登録されていません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {relationships.map((relationship) => (
              <li
                className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-4"
                key={relationship.id}
              >
                <p className="font-medium">{friendDisplayName(relationship.partner)}</p>
                <p className="text-sm text-slate-600">{describeRelationship(relationship, friendId)}</p>
                {relationship.note ? (
                  <p className="text-sm text-slate-500">{relationship.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isModalOpen ? (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold">関係性を追加</h2>

            {modalErrors.form.length > 0 ? (
              <div className="mt-3 flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-600">
                {modalErrors.form.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            ) : null}

            {modalNotFound && modalErrors.form.length === 0 ? (
              <p className="mt-3 text-sm text-red-600">対象の友達が見つかりません。</p>
            ) : null}

            <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium" htmlFor="friend_b_id">
                  相手の友達
                </label>
                <select
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  defaultValue=""
                  id="friend_b_id"
                  name="friend_b_id"
                  required
                >
                  <option disabled value="">
                    選択してください
                  </option>
                  {otherFriends.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {friendDisplayName(candidate)}
                    </option>
                  ))}
                </select>
                {modalErrors.fields.friend_b_id?.map((message) => (
                  <p className="text-sm text-red-600" key={message}>
                    {message}
                  </p>
                ))}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium" htmlFor="relationship_type">
                  関係タイプ
                </label>
                <input
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  id="relationship_type"
                  maxLength={LIMITS.RELATIONSHIP_TYPE_MAX}
                  name="relationship_type"
                  placeholder="例：同じサークル、先輩後輩"
                  required
                  type="text"
                />
                {modalErrors.fields.relationship_type?.map((message) => (
                  <p className="text-sm text-red-600" key={message}>
                    {message}
                  </p>
                ))}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium" htmlFor="note">
                  メモ
                </label>
                <textarea
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                  id="note"
                  maxLength={LIMITS.RELATIONSHIP_NOTE_MAX}
                  name="note"
                  rows={3}
                />
                {modalErrors.fields.note?.map((message) => (
                  <p className="text-sm text-red-600" key={message}>
                    {message}
                  </p>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="is_directional">
                <input id="is_directional" name="is_directional" type="checkbox" />
                一方向の関係（例：先輩→後輩）
              </label>

              <div className="flex justify-end gap-2">
                <button
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
                  disabled={submitting}
                  onClick={closeModal}
                  type="button"
                >
                  キャンセル
                </button>
                <button
                  className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  disabled={submitting}
                  type="submit"
                >
                  {submitting ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
