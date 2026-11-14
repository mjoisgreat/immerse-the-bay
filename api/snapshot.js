import * as api from "../server/api.js";
import { route, readJson } from "./_lib/http.js";
export default route({
  GET: (req, store) => api.snapshotGet(store, req.query),
  POST: async (req, store) => api.snapshotPost(store, await readJson(req)),
});
