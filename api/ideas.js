import * as api from "../server/api.js";
import { route, readJson } from "./_lib/http.js";
export default route({ POST: async (req, store) => api.ideas(store, await readJson(req)) });
