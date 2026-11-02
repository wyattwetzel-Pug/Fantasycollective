import { Suspense } from "react";
import { signIn, signUp } from "./actions";

const input = "w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2";
const button = "w-full rounded bg-green-500 px-3 py-2 font-semibold text-black hover:bg-green-400";

async function Notice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { error, message } = await searchParams;
  if (error) return <p className="mb-4 rounded bg-red-950 p-3 text-red-300">{error}</p>;
  if (message) return <p className="mb-4 rounded bg-green-950 p-3 text-green-300">{message}</p>;
  return null;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-md p-6">
      <Suspense>
        <Notice searchParams={props.searchParams} />
      </Suspense>

      <h1 className="mb-3 text-2xl font-bold">Log in</h1>
      <form action={signIn} className="mb-10 space-y-3">
        <input name="email" type="email" required placeholder="Email" className={input} />
        <input name="password" type="password" required placeholder="Password" className={input} />
        <button className={button}>Log in</button>
      </form>

      <h2 className="mb-3 text-2xl font-bold">Create an account</h2>
      <form action={signUp} className="space-y-3">
        <input name="display_name" required placeholder="Display name" className={input} />
        <input name="email" type="email" required placeholder="Email" className={input} />
        <input name="password" type="password" required minLength={8} placeholder="Password (8+ characters)" className={input} />
        <button className={button}>Sign up</button>
      </form>
      <p className="mt-3 text-xs text-zinc-400">
        New accounts are viewers. If you were invited as a contributor, sign up with the email you were invited at.
      </p>
    </main>
  );
}
