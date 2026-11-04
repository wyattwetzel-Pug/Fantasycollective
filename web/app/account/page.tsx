import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { sessionUser } from "@/lib/session";
import { Face } from "@/app/face";
import { removePhoto, saveAccount } from "./actions";

async function AccountView({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await sessionUser();
  if (!user) {
    return <div className="gl-panel p-5 text-sm"><Link href="/login" className="underline" style={{ color: "var(--accent)" }}>Log in</Link> to see your account.</div>;
  }
  const supabase = await createClient();
  const [{ data: p }, { data: au }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_url, role").eq("id", user.id).maybeSingle<{ display_name: string | null; avatar_url: string | null; role: string }>(),
    supabase.auth.getUser(),
  ]);
  const err = typeof sp.error === "string" ? sp.error : "", msg = typeof sp.msg === "string" ? sp.msg : "";

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="gl-hero p-5 sm:p-7">
        <p className="text-[11px] font-semibold tracking-[0.35em] text-zinc-400">YOUR ACCOUNT</p>
        <h2 className="gl-title text-5xl sm:text-6xl">Profile</h2>
      </div>
      {err && <p className="rounded-xl border border-red-900 bg-red-950 p-3 text-sm text-red-300">{err}</p>}
      {msg && <p className="rounded-xl border border-green-900 bg-green-950 p-3 text-sm text-green-300">{msg}</p>}

      <form action={saveAccount} className="gl-panel space-y-4 p-5">
        <div className="flex items-center gap-4">
          <Face url={p?.avatar_url ?? null} name={p?.display_name ?? "?"} size={84} />
          <div className="space-y-1 text-sm">
            <label htmlFor="photo" className="font-bold">Profile picture</label>
            <input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="block text-xs" />
            <p className="text-xs text-zinc-400">JPG, PNG or WebP, up to 2 MB.</p>
          </div>
        </div>
        <div>
          <label htmlFor="display_name" className="mb-1 block text-sm font-bold">Display name</label>
          <input id="display_name" name="display_name" defaultValue={p?.display_name ?? ""} required minLength={2} maxLength={30} className="gl-search !w-full" />
        </div>
        <div className="text-sm">
          <p className="font-bold">Email</p>
          <p className="text-zinc-400">{au.user?.email}</p>
        </div>
        <p className="text-sm"><span className="font-bold">Role</span> <span className="text-zinc-400">{p?.role === "contributor" ? "Contributor" : "Member"}</span></p>
        <button className="gl-pill on !px-6">Save</button>
      </form>
      {p?.avatar_url && (
        <form action={removePhoto}><button className="text-sm text-red-400">Remove my picture</button></form>
      )}
    </div>
  );
}

export default function AccountPage(props: PageProps<"/account">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-10 md:py-8">
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <AccountView searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
