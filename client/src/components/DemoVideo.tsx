import { useState } from "react";

// The player (and YouTube's scripts and cookies) loads only after a click; until then it is a thumbnail.
export function DemoVideo({ videoId, title }: { videoId: string; title: string }) {
    const [playing, setPlaying] = useState(false);

    return (
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
            {playing ? (
                <iframe
                    className="absolute inset-0 size-full"
                    src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
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
