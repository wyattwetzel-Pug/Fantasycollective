import { Suspense } from "react";
import { signIn, signUp } from "./actions";

const input = "gl-search !w-full";
const button = "gl-pill on !w-full justify-center";

async function Notice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { error, message } = await searchParams;
  if (error) return <p className="mb-4 rounded bg-red-950 p-3 text-red-300">{error}</p>;
  if (message) return <p className="mb-4 rounded bg-green-950 p-3 text-green-300">{message}</p>;
  return null;
}

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-6">
      <Suspense>
        <Notice searchParams={props.searchParams} />
      </Suspense>

      <div className="gl-panel space-y-3 p-5">
      <h1 className="text-3xl">Log in</h1>
      <form action={signIn} className="space-y-3">
        <input name="email" type="email" required placeholder="Email" className={input} />
        <input name="password" type="password" required placeholder="Password" className={input} />
        <button className={button}>Log in</button>
      </form>
      </div>

      <div className="gl-panel space-y-3 p-5">
      <h2 className="text-3xl">Create an account</h2>
      <form action={signUp} className="space-y-3">
        <input name="display_name" required placeholder="Display name" className={input} />
        <input name="email" type="email" required placeholder="Email" className={input} />
        <input name="password" type="password" required minLength={8} placeholder="Password (8+ characters)" className={input} />
        <button className={button}>Sign up</button>
      </form>
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        New accounts are viewers. If you were invited as a contributor, sign up with the email you were invited at.
      </p>
    </main>
  );
}
