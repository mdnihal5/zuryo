import bcrypt from "bcryptjs";
import { config } from "../config/index.js";

export const hashPassword = (plain: string) => bcrypt.hash(plain, config.bcryptCost);

// Compared against when the email is unknown, so "no such user" costs the same time as "wrong password".
const dummyHash = bcrypt.hashSync("not-a-real-password", config.bcryptCost);

export async function verifyPassword(plain: string, hash: string | undefined): Promise<boolean> {
    const ok = await bcrypt.compare(plain, hash ?? dummyHash);
    return hash !== undefined && ok;
}
