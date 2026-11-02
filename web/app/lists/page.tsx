import { redirect } from "next/navigation";

// Lists are now edited from the Rankings page (Edit button), so this index is gone.
export default function ListsPage() {
  redirect("/rankings");
}
