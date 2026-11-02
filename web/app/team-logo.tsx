// An NFL team's logo from Sleeper's image server. Renders nothing for free agents.
export function TeamLogo({ team, size = 28 }: { team: string | null | undefined; size?: number }) {
  if (!team) return <span className="text-zinc-500">FA</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`} alt={team} title={team} width={size} height={size} loading="lazy" className="mx-auto object-contain" style={{ width: size, height: size }} />
  );
}
