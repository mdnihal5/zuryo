import { useEffect, useState } from "react";
import { serverTime } from "./clock";

// Server time as a number that updates every second (or `everyMs`).
export function useServerNow(everyMs = 1000) {
    const [now, setNow] = useState(serverTime);
    useEffect(() => {
        const id = setInterval(() => setNow(serverTime()), everyMs);
        return () => clearInterval(id);
    }, [everyMs]);
    return now;
}
