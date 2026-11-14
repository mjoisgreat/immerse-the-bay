import * as api from "../server/api.js";
import { route, readJson } from "./_lib/http.js";
export default route({
  GET: (req, store) => api.relayGet(store, req.query),
  POST: async (req, store) => api.relayPost(store, await readJson(req)),
});
