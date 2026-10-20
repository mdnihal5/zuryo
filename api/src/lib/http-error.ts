// The one error type for expected failures. The message is safe to show a client.
export class HttpError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
        public details?: unknown,
    ) {
        super(message);
    }
}

export const notFound = (code: string, message: string) => new HttpError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) =>
    new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string) => new HttpError(422, code, message);
