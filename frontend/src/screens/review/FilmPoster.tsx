import { FilmIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Fixed frames, so a list of hits never reflows while its posters load. */
const FRAME = {
  thumb: "h-[69px] w-[46px]",
  preview: "h-[138px] w-[92px]",
} as const;

type Props = {
  url: string;
  size: keyof typeof FRAME;
};

/** A film's poster over a neutral frame, which stays when there is none or it fails to load. */
export function FilmPoster({ url, size }: Props) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground/60",
        FRAME[size],
      )}
    >
      <FilmIcon className={size === "thumb" ? "size-4" : "size-6"} />
      {url && url !== brokenUrl && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setBrokenUrl(url)}
        />
      )}
    </span>
  );
}
