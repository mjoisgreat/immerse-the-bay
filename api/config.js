import * as api from "../server/api.js";
import { route } from "./_lib/http.js";
export default route({ GET: () => api.config() }, { needsStore: false });
