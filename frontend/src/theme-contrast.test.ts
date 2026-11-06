import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];
type Tokens = Record<string, string>;

const AA_TEXT = 4.5;
const css = readFileSync("src/index.css", "utf-8");

function tokensIn(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/g)].map(([, name, hex]) => [name, hex]));
}

const rgbOf = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;

/** The colour seen when `color` is laid over `under` at this opacity. */
const over = (color: Rgb, under: Rgb, opacity: number): Rgb =>
  color.map((channel, index) => channel * opacity + under[index] * (1 - opacity)) as Rgb;

function luminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: Rgb, second: Rgb): number {
  const [lighter, darker] = [luminance(first), luminance(second)].toSorted((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT = tokensIn(":root");
const DARK = { ...LIGHT, ...tokensIn(':root[data-theme="dark"]') };

function pairings(tokens: Tokens, tintAtRest: number, tintOnHover: number): [string, Rgb, Rgb][] {
  const { background, card, primary, destructive } = tokens;
  const onPrimary = rgbOf(tokens["primary-foreground"]);
  const onPages = [background, card].map(rgbOf);

  return [
    ...onPages.flatMap((page): [string, Rgb, Rgb][] => [
      ["destructive text", rgbOf(destructive), page],
      ["destructive button", rgbOf(destructive), over(rgbOf(destructive), page, tintAtRest)],
      ["destructive button on hover", rgbOf(destructive), over(rgbOf(destructive), page, tintOnHover)],
      ["primary text", rgbOf(primary), page],
      ["primary button on hover", onPrimary, over(rgbOf(primary), page, 0.9)],
    ]),
    ["primary button", onPrimary, rgbOf(primary)],
    ["active sidebar item", rgbOf(primary), rgbOf(tokens["sidebar-accent"])],
  ];
}

describe("the theme's text colours", () => {
  it("measures contrast as WCAG does", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21);
  });

  it.each(pairings(LIGHT, 0.1, 0.2))("%s stays readable in the light theme", (_name, text, surface) => {
    expect(contrast(text, surface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(pairings(DARK, 0.2, 0.3))("%s stays readable in the dark theme", (_name, text, surface) => {
    expect(contrast(text, surface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("is the same dark theme whether chosen or inherited from the system", () => {
    const inherited = tokensIn(':root:not([data-theme="light"])');

    expect(inherited).toEqual(tokensIn(':root[data-theme="dark"]'));
  });
});
