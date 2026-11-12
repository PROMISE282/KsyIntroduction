import { makeHandlers } from "../_lib/handlers.js";
import { defaultDeps } from "../_lib/http.js";

export const POST = makeHandlers(defaultDeps()).ownerLogin;
