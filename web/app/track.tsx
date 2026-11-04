"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Tells the server which page was opened, with an anonymous id (kept in this browser) to count unique visitors.
export function Track() {
  const pathname = usePathname();
  useEffect(() => {
    let visitor = "";
    try {
      visitor = localStorage.getItem("ff-visitor") ?? "";
      if (!visitor) { visitor = crypto.randomUUID(); localStorage.setItem("ff-visitor", visitor); }
    } catch { /* storage blocked */ }
    fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: pathname, visitor }), keepalive: true }).catch(() => {});
  }, [pathname]);
  return null;
}
