"use server";

import { createClient } from "@/lib/supabase/server";
import type { Friend, NewFriendInput } from "./types";

export async function getFriends(): Promise<Friend[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("friends")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function getFriendById(id: string): Promise<Friend | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("friends").select("*").eq("id", id).maybeSingle();

  if (error) {
    // 22P02: invalid input syntax for type uuid — URL上のidが不正な形式のときは「見つからない」として扱う
    if (error.code === "22P02") return null;
    throw error;
  }
  return data;
}

export async function createFriend(input: NewFriendInput): Promise<Friend> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("friends").insert(input).select().single();

  if (error) throw error;
  return data;
}
