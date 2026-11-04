"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (key: "error" | "msg", text: string) => redirect(`/account?${key}=${encodeURIComponent(text)}`);
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function me() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  if (!id) redirect("/login");
  return { supabase, id };
}

export async function saveAccount(formData: FormData) {
  const { supabase, id } = await me();
  const name = String(formData.get("display_name") ?? "").trim();
  if (name.length < 2 || name.length > 30) back("error", "Your display name should be 2 to 30 characters.");
  const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", id);
  if (error) back("error", error.message);

  const file = formData.get("photo");
  if (file instanceof File && file.size > 0) {
    const ext = TYPES[file.type];
    if (!ext) back("error", "Use a JPG, PNG or WebP picture.");
    if (file.size > 2 * 1024 * 1024) back("error", "That picture is over 2 MB. Pick a smaller one.");
    const path = `${id}/avatar-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
    if (up.error) back("error", `Couldn't upload the picture: ${up.error.message}`);
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await supabase.from("profiles").update({ avatar_url: url }).eq("id", id);
  }
  revalidatePath("/", "layout");
  back("msg", "Saved.");
}

export async function removePhoto() {
  const { supabase, id } = await me();
  await supabase.from("profiles").update({ avatar_url: null }).eq("id", id);
  revalidatePath("/", "layout");
  back("msg", "Picture removed.");
}
