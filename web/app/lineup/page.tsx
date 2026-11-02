import { redirect } from "next/navigation";

// The lineup now lives on My Teams.
export default function LineupPage() {
  redirect("/teams");
}
