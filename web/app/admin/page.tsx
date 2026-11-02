import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { inviteContributor, removeContributor, revokeInvite, syncStats } from "./actions";

export const maxDuration = 60;

type ContributorRow = {
  profile_id: string;
  slug: string;
  profiles: { display_name: string; role: string; is_admin: boolean } | null;
};

async function AdminPanel({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const syncMsg = typeof sp.sync === "string" ? sp.sync : "";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) redirect("/rankings");

  const { data: invites } = await supabase
    .from("invites").select("id, email, expires_at, accepted_at").is("accepted_at", null).order("created_at", { ascending: false });
  const { data: contributors } = await supabase
    .from("contributors").select("profile_id, slug, profiles!contributors_profile_id_fkey(display_name, role, is_admin)").returns<ContributorRow[]>();
  const active = (contributors ?? []).filter((c) => c.profiles?.role === "contributor");

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 text-xl font-bold">Invite a contributor</h2>
        <form action={inviteContributor} className="flex gap-2">
          <input name="email" type="email" required placeholder="friend@example.com" className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2" />
          <button className="rounded bg-green-500 px-4 py-2 font-semibold text-black">Invite</button>
        </form>
        <p className="mt-2 text-xs text-zinc-400">
          Existing accounts are promoted immediately. Otherwise they become a contributor when they sign up with this email (invite lasts 30 days).
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Stats and schedule</h2>
        {syncMsg && <p className="mb-3 rounded border border-zinc-700 p-3 text-sm text-zinc-200">{syncMsg}</p>}
        <div className="flex flex-wrap gap-2">
          <form action={syncStats}><input type="hidden" name="mode" value="recent" /><button className="rounded bg-green-500 px-4 py-2 text-sm font-semibold text-black">Sync this week</button></form>
          <form action={syncStats}><input type="hidden" name="mode" value="backfill" /><button className="rounded border border-zinc-600 px-4 py-2 text-sm">Load the whole season</button></form>
        </div>
        <p className="mt-2 text-xs text-zinc-400">Pulls schedule, weekly stats and projections from Sleeper. It also runs by itself once a day on the live site. Loading the whole season can take up to a minute.</p>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Pending invites</h2>
        {invites?.length ? (
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between rounded border border-zinc-800 p-3">
                <span>{i.email}</span>
                <form action={revokeInvite}>
                  <input type="hidden" name="id" value={i.id} />
                  <button className="text-sm text-red-400">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        ) : <p className="text-zinc-400">None.</p>}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Contributors</h2>
        <ul className="space-y-2">
          {active.map((c) => (
            <li key={c.profile_id} className="flex items-center justify-between rounded border border-zinc-800 p-3">
              <span>
                {c.profiles?.display_name}
                {c.profiles?.is_admin && <span className="ml-2 rounded bg-green-900 px-2 py-0.5 text-xs text-green-300">Admin</span>}
              </span>
              {!c.profiles?.is_admin && (
                <form action={removeContributor}>
                  <input type="hidden" name="id" value={c.profile_id} />
                  <button className="text-sm text-red-400">Remove (keeps their list, unpublished)</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function AdminPage(props: PageProps<"/admin">) {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="mb-6 text-3xl font-bold">Admin</h1>
      <Suspense fallback={<p className="text-zinc-400">Loading...</p>}>
        <AdminPanel searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
