import * as api from "../server/api.js";
import { route, readBody } from "./_lib/http.js";
export default route({ POST: async (req, store) => api.speech(store, req.headers, await readBody(req)) });
