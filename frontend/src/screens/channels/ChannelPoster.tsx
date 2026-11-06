import { useState, type ReactNode } from "react";

import { initialsOf } from "@/screens/channels/channel";

type Props = {
  title: string;
  url: string | null;
  /** Overlaid on the image, such as status badges. */
  children?: ReactNode;
};

/** A poster over the title's initials, which stay in place for art that is missing or broken. */
export function ChannelPoster({ title, url, children }: Props) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);

  return (
    <span className="relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden bg-muted">
      <span aria-hidden="true" className="text-3xl font-semibold text-muted-foreground">
        {initialsOf(title)}
      </span>
      {url && url !== brokenUrl && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={() => setBrokenUrl(url)}
        />
      )}
      {children}
    </span>
  );
}
