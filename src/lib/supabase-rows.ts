type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function allRows<T>(fetchPage: (start: number, end: number) => Page<T>) {
  const rows: T[] = [];
  const size = 100;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await fetchPage(offset, offset + size - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}
