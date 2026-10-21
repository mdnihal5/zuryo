import { useEffect, useRef, useState } from "react";

// The player (and YouTube's scripts) loads only once the video scrolls into view, then plays muted on a loop;
// the video has no sound, and browsers only autoplay muted. Reduced-motion users get click-to-play instead.
export function DemoVideo({ videoId, title }: { videoId: string; title: string }) {
    const box = useRef<HTMLDivElement>(null);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !box.current) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setPlaying(true);
                observer.disconnect();
            }
        });
        observer.observe(box.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div ref={box} className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
            {playing ? (
                <iframe
                    className="absolute inset-0 size-full"
                    src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&playsinline=1&rel=0`}
                    title={title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                />
            ) : (
                <button
                    className="group absolute inset-0 size-full"
                    onClick={() => setPlaying(true)}
                    aria-label={`Play: ${title}`}
                >
                    <img
                        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                        alt=""
                        width={480}
                        height={360}
                        loading="lazy"
                        onError={(e) => (e.currentTarget.hidden = true)}
                        className="size-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                    />
                    <span className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg transition-transform group-hover:scale-105">
                        <svg viewBox="0 0 24 24" className="ml-1 size-7" aria-hidden="true">
                            <path d="M8 5v14l11-7z" fill="currentColor" />
                        </svg>
                    </span>
                </button>
            )}
        </div>
    );
}
