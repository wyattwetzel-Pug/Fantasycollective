// The database returns at most 1000 rows a request, so big tables are read a page at a time.
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data } = await page(from, from + 999);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}
