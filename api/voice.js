import * as api from "../server/api.js";
import { route, readJson } from "./_lib/http.js";
export default route({ POST: async (req, store) => api.voice(store, await readJson(req)) });
