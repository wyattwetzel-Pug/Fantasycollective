// A person's profile picture in a circle, with their initials when they haven't added one.
export function Face({ url, name, size = 36 }: { url: string | null; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#DEDAD0] font-bold" style={{ width: size, height: size, fontSize: size / 2.8 }} aria-hidden="true">
      {initials}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}
