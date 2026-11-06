import { useState, type ReactNode } from "react";

import { initialsOf } from "@/screens/channels/channel";

type Props = {
  title: string;
  /** The images to try, the preferred one first. */
  urls: string[];
  /** Overlaid on the image, such as status badges. */
  children?: ReactNode;
};

/** The first image that loads, over the title's initials, which stay in place when none does. */
export function ChannelPoster({ title, urls, children }: Props) {
  const [brokenUrls, setBrokenUrls] = useState<readonly string[]>([]);
  const url = urls.find((candidate) => !brokenUrls.includes(candidate));

  return (
    <span className="relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden bg-muted">
      <span aria-hidden="true" className="text-3xl font-semibold text-muted-foreground">
        {initialsOf(title)}
      </span>
      {url && (
        <img
          key={url}
          src={url}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={() => setBrokenUrls((broken) => [...broken, url])}
        />
      )}
      {children}
    </span>
  );
}
