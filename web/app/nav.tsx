import Link from "next/link";
import { signOut } from "./login/actions";
import { createClient } from "@/lib/supabase/server";

// Top bar: player search, plus who is signed in and log in / log out.
export async function Nav() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("display_name").eq("id", user.id).single()
    : { data: null };

  return (
    <header className="flex items-center justify-end gap-3 px-4 py-4 text-sm md:px-10">
      <form action="/rankings" className="w-full max-w-sm">
        <label htmlFor="topsearch" className="sr-only">Search players</label>
        <input id="topsearch" name="q" type="search" placeholder="Search players, teams, or stats..." className="gl-search" />
      </form>
      {me ? (
        <>
          <span className="hidden rounded-full bg-[#FBFAF6] px-4 py-2 font-semibold sm:inline" style={{ border: "1px solid #DEDAD0" }}>{me.display_name}</span>
          <form action={signOut}><button className="rounded-full px-3 py-2 text-zinc-400 hover:text-black">Log out</button></form>
        </>
      ) : (
        <Link href="/login" className="gl-pill on">Log in</Link>
      )}
    </header>
  );
}
