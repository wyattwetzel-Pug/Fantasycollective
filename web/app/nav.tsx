import Link from "next/link";
import { signOut } from "./login/actions";
import { createClient } from "@/lib/supabase/server";

// Slim top bar: who is signed in, plus log in / log out.
export async function Nav() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("display_name").eq("id", user.id).single()
    : { data: null };

  return (
    <header className="flex items-center justify-end gap-4 border-b border-zinc-800 px-4 py-3 text-sm md:px-10">
      {me ? (
        <>
          <span className="text-zinc-400">{me.display_name}</span>
          <form action={signOut}><button className="text-zinc-300">Log out</button></form>
        </>
      ) : (
        <Link href="/login" className="rounded-full border border-zinc-500 px-4 py-1.5">Log in</Link>
      )}
    </header>
  );
}
