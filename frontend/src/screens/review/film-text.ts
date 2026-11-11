import type { FilmHit } from "./review-api";

/** `Title (year) · Original title`, the original only when it differs. */
export function filmLabel({ title, year, original_title }: FilmHit): string {
  const dated = year ? `${title} (${year})` : title;
  return otherTitle({ title, original_title }) ? `${dated} · ${original_title}` : dated;
}

/** The original title, when it is not the one shown. */
export function otherTitle({ title, original_title }: Pick<FilmHit, "title" | "original_title">): string | null {
  return original_title && original_title !== title ? original_title : null;
}
