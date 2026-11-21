const PREFIX = 'decision:';
const PAGE_SIZE = 100;
// Search ranks in memory, so the whole set is loaded. Past this size the app needs
// a real index (Forge SQL) rather than a larger number here.
const MAX_DECISIONS = 2000;

/** Decision persistence on the Forge key-value store. */
export function createStore({ kvs, WhereConditions }) {
  return {
    async get(id) {
      return (await kvs.get(PREFIX + id)) ?? null;
    },

    async put(decision) {
      await kvs.set(PREFIX + decision.id, decision);
      return decision;
    },

    async remove(id) {
      await kvs.delete(PREFIX + id);
    },

    async list() {
      const decisions = [];
      let cursor;
      do {
        let query = kvs
          .query()
          .where('key', WhereConditions.beginsWith(PREFIX))
          .limit(PAGE_SIZE);
        if (cursor) query = query.cursor(cursor);
        const page = await query.getMany();
        for (const { value } of page.results) decisions.push(value);
        cursor = page.nextCursor;
      } while (cursor && decisions.length < MAX_DECISIONS);
      return decisions;
    },
  };
}
