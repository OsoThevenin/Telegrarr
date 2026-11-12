import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { initialsOf } from "@/screens/channels/channel";

type Props = {
  title: string;
  /** The images to try, the preferred one first. */
  urls: string[];
  /** Faded, for a show that is switched off. Overlaid children keep their colour. */
  isDimmed?: boolean;
  /** The frame's shape; square by default, as Telegram photos are. */
  className?: string;
  /** Overlaid on the image, such as status badges. */
  children?: ReactNode;
};

/**
 * The first image that loads, over the title's initials, which stay in place when none does.
 * Cropped from the top, so a movie poster keeps its title.
 */
export function ChannelPoster({ title, urls, isDimmed = false, className, children }: Props) {
  const [brokenUrls, setBrokenUrls] = useState<readonly string[]>([]);
  const url = urls.find((candidate) => !brokenUrls.includes(candidate));
  const dim = isDimmed && "opacity-45 grayscale";

  return (
    <span className={cn("relative flex aspect-square w-full items-center justify-center overflow-hidden bg-muted", className)}>
      <span aria-hidden="true" className={cn("text-3xl font-semibold text-muted-foreground", dim)}>
        {initialsOf(title)}
      </span>
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          loading="lazy"
          className={cn("absolute inset-0 size-full object-cover object-top", dim)}
          onError={() => setBrokenUrls((broken) => [...broken, url])}
        />
      )}
      {children}
    </span>
  );
}
