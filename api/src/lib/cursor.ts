// Opaque cursor for lists sorted by (starts_at, id). Offset paging skips or repeats rows when data changes.
export type Cursor = { startsAt: Date; id: number };

export const encodeCursor = (c: Cursor) => Buffer.from(`${c.startsAt.toISOString()}|${c.id}`).toString("base64url");

export function decodeCursor(raw: string): Cursor | null {
    const [iso, id] = Buffer.from(raw, "base64url").toString().split("|");
    const startsAt = new Date(iso ?? "");
    const n = Number(id);
    return Number.isNaN(startsAt.getTime()) || !Number.isInteger(n) ? null : { startsAt, id: n };
}

// Callers fetch limit + 1 rows; the extra row only tells us there is a next page.
export function pageOf<T extends { starts_at: Date; id: number }, V>(rows: T[], limit: number, toView: (r: T) => V) {
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ startsAt: last.starts_at, id: last.id }) : null;
    return { items: items.map(toView), nextCursor };
}
