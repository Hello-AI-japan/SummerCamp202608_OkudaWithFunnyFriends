import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";

export async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <Link className="text-sm font-semibold" href="/">
          SummerCamp Friends
        </Link>

        {user ? (
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user.email}</span>
            <LogoutButton />
          </div>
        ) : (
          <nav className="flex items-center gap-3">
            <Link
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-100"
              href="/login"
            >
              Log in
            </Link>
            <Link
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              href="/signup"
            >
              Sign up
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
