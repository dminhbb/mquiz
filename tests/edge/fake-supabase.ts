/**
 * Minimal in-memory stand-in for @supabase/supabase-js, wired in through tests/edge/deno.json.
 * It implements only the query-builder calls the Edge Functions use.
 */
type Row = Record<string, unknown>;
type DbError = { code?: string; message: string } | null;
type Result = { data: unknown; error: DbError; count?: number | null };
type RpcHandler = (args: Row) => { data: unknown; error: DbError };
type InsertHook = (row: Row) => void;

export const db = {
  tables: {} as Record<string, Row[]>,
  rpcs: {} as Record<string, RpcHandler>,
  insertHooks: {} as Record<string, InsertHook>,
  /** Throws this when set, to simulate an unexpected database failure. */
  failTable: null as string | null,
  /** Maps a bearer token to an auth user id for the caller client. */
  users: {} as Record<string, string>,
  reset() {
    this.tables = {};
    this.rpcs = {};
    this.insertHooks = {};
    this.failTable = null;
    this.users = {};
  }
};

class QueryBuilder implements PromiseLike<Result> {
  private operation: "select" | "insert" | "update" = "select";
  private payload: Row | Row[] = {};
  private filters: Array<(row: Row) => boolean> = [];
  private returning = false;
  private singleMode: "single" | "maybeSingle" | null = null;
  private rangeBounds: [number, number] | null = null;
  private limitCount: number | null = null;
  private orderColumn: string | null = null;
  private countOnly = false;

  constructor(private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    if (this.operation === "select") this.operation = "select";
    else this.returning = true;
    this.countOnly = Boolean(options?.head);
    return this;
  }
  insert(payload: Row | Row[]) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  order(column: string) {
    this.orderColumn = column;
    return this;
  }
  range(from: number, to: number) {
    this.rangeBounds = [from, to];
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  // deno-lint-ignore no-explicit-any
  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private execute(): Result {
    if (db.failTable === this.table) {
      return { data: null, error: { message: "secret internal table detail xyz" } };
    }
    const rows = (db.tables[this.table] ??= []);
    if (this.operation === "insert") return this.runInsert(rows);

    const matching = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === "update") {
      for (const row of matching) Object.assign(row, this.payload);
      return this.shape(this.returning ? matching.map((row) => ({ ...row })) : null);
    }
    if (this.countOnly) return { data: null, error: null, count: matching.length };

    let result = matching.map((row) => ({ ...row }));
    if (this.orderColumn) {
      const column = this.orderColumn;
      result.sort((a, b) => Number(a[column]) - Number(b[column]));
    }
    if (this.rangeBounds) result = result.slice(this.rangeBounds[0], this.rangeBounds[1] + 1);
    if (this.limitCount !== null) result = result.slice(0, this.limitCount);
    return this.shape(result);
  }

  private runInsert(rows: Row[]): Result {
    const created: Row[] = [];
    for (const item of Array.isArray(this.payload) ? this.payload : [this.payload]) {
      const row: Row = { id: crypto.randomUUID(), submitted_at: new Date().toISOString(), ...item };
      try {
        db.insertHooks[this.table]?.(row);
      } catch (error) {
        const { code, message } = error as { code?: string; message: string };
        return { data: null, error: { code, message } };
      }
      rows.push(row);
      created.push({ ...row });
    }
    return this.shape(this.returning ? created : null);
  }

  private shape(data: Row[] | null): Result {
    if (!this.singleMode || data === null) return { data, error: null };
    if (data.length > 1) return { data: null, error: { message: "multiple rows returned" } };
    if (data.length === 0 && this.singleMode === "single") {
      return { data: null, error: { message: "no rows returned" } };
    }
    return { data: data[0] ?? null, error: null };
  }
}

class FakeClient {
  constructor(private readonly authorization = "") {}

  from(table: string) {
    return new QueryBuilder(table);
  }

  rpc(name: string, args: Row) {
    const handler = db.rpcs[name];
    if (!handler) return Promise.resolve({ data: null, error: { message: `no rpc ${name}` } });
    return Promise.resolve(handler(args));
  }

  get auth() {
    const token = this.authorization.replace(/^Bearer /, "");
    return {
      getUser: () => {
        const id = db.users[token];
        return Promise.resolve(
          id
            ? { data: { user: { id } }, error: null }
            : { data: { user: null }, error: { message: "bad jwt" } }
        );
      },
      admin: {
        createUser: () => Promise.resolve({ data: null, error: { message: "unused" } }),
        deleteUser: () => Promise.resolve({ error: null }),
        updateUserById: () => Promise.resolve({ error: null })
      }
    };
  }
}

export function createClient(
  _url: string,
  _key: string,
  options?: { global?: { headers?: Record<string, string> } }
) {
  return new FakeClient(options?.global?.headers?.Authorization ?? "");
}
