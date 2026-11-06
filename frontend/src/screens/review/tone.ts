/**
 * The theme's `--destructive` reads at about 3:1 as light-theme text. Mixing in the foreground
 * lifts it past 4.5:1 in both themes, also on the button's own destructive tint.
 */
export const DESTRUCTIVE_TEXT = "text-[color-mix(in_oklab,var(--destructive)_70%,var(--foreground))]";
