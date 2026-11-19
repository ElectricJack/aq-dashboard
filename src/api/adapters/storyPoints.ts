export const MAX_STORY_POINTS = 1000;

export function validStoryPoints(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_STORY_POINTS;
}

export function storyPointsProblem(value: string): string | null {
  const text = value.trim();
  return text && (!/^[1-9]\d*$/.test(text) || !validStoryPoints(Number(text)))
    ? `Enter a whole number from 1 to ${MAX_STORY_POINTS}.`
    : null;
}
