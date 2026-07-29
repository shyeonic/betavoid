import {
  getOrCreateWorldState,
  getWorldAdminSummary,
  listWorldAdminEntities,
  rebuildWorldState
} from "../src/world-state.js";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/state") {
        return json(await getOrCreateWorldState(env.WORLD_DB));
      }
      if (request.method === "GET" && url.pathname === "/summary") {
        return json(await getWorldAdminSummary(env.WORLD_DB));
      }
      if (request.method === "GET" && url.pathname === "/entities") {
        return json(await listWorldAdminEntities(env.WORLD_DB, {
          entityType: url.searchParams.get("entity_type"),
          sectorId: url.searchParams.get("sector_id"),
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit")
        }));
      }
      if (request.method === "POST" && url.pathname === "/rebuild") {
        const body = await request.json();
        return json(await rebuildWorldState(env.WORLD_DB, {
          expectedRevision: body.expected_revision
        }));
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({
        error: error?.message || "Unexpected error.",
        code: error?.code || "INTERNAL_ERROR"
      }, Number(error?.status) || 500);
    }
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
