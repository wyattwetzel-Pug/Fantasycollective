import Link from "next/link";

// A player's name that opens his profile page.
export function PlayerLink({ id, name, className = "" }: { id: number; name: string | undefined; className?: string }) {
  return <Link href={`/players/${id}`} className={`pn hover:underline ${className}`}>{name}</Link>;
}
