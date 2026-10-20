import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

export type TokenClaims = { sub: number; tv: number };

export const signToken = (userId: number, tokenVersion: number) =>
    jwt.sign({ tv: tokenVersion }, config.jwtSecret, {
        algorithm: "HS256",
        subject: String(userId),
        expiresIn: `${config.jwtExpiresInHours}h`,
    });

export function verifyToken(token: string): TokenClaims | null {
    try {
        const p = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
        if (typeof p === "string" || typeof p.sub !== "string" || typeof p.tv !== "number") return null;
        return { sub: Number(p.sub), tv: p.tv };
    } catch {
        return null;
    }
}
