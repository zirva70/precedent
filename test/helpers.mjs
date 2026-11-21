// An in-memory stand-in for @forge/kvs, covering the calls the store makes.
export function fakeKvs({ pageSize = 100 } = {}) {
  const data = new Map();
  const WhereConditions = { beginsWith: (prefix) => ({ beginsWith: prefix }) };

  const kvs = {
    data,
    writes: [],
    failOnWrite: null, // set to a predicate to simulate a storage failure
    async get(key) {
      return data.get(key);
    },
    async set(key, value) {
      if (kvs.failOnWrite?.(key, value)) throw new Error('storage unavailable');
      kvs.writes.push(key);
      data.set(key, structuredClone(value));
    },
    async delete(key) {
      data.delete(key);
    },
    query() {
      const state = { prefix: '', limit: pageSize, cursor: 0 };
      const builder = {
        where(field, condition) {
          state.prefix = condition.beginsWith;
          return builder;
        },
        limit(n) {
          state.limit = Math.min(n, pageSize);
          return builder;
        },
        cursor(c) {
          state.cursor = Number(c);
          return builder;
        },
        async getMany() {
          const all = [...data.entries()]
            .filter(([key]) => key.startsWith(state.prefix))
            .sort(([a], [b]) => a.localeCompare(b));
          const page = all.slice(state.cursor, state.cursor + state.limit);
          const next = state.cursor + state.limit;
          return {
            results: page.map(([key, value]) => ({ key, value: structuredClone(value) })),
            nextCursor: next < all.length ? String(next) : undefined,
          };
        },
      };
      return builder;
    },
  };
  return { kvs, WhereConditions };
}

// Deterministic clock: each call is one minute later than the last.
export function tickingClock(start = '2026-11-10T09:00:00.000Z') {
  let time = Date.parse(start);
  return () => {
    const now = new Date(time).toISOString();
    time += 60_000;
    return now;
  };
}

// Deterministic "random": cycles through the given values in [0, 1).
export function sequence(values) {
  let index = 0;
  return () => values[index++ % values.length];
}
