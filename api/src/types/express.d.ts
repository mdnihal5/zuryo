import type { AuthUser } from "./index.js";

declare global {
    namespace Express {
        interface Request {
            id: string;
            user?: AuthUser;
            // Filled by the validate() middleware with the parsed body/query/params/headers.
            valid: { body?: any; query?: any; params?: any; headers?: any };
        }
    }
}
export {};
