/** Follow the horizontal tab list's arrow, Home and End keyboard behavior. */
export function nextTab<T>(enabled: readonly T[], current: T, key: string): T | undefined {
  const index = enabled.indexOf(current), last = enabled.length - 1;
  switch (key) {
    case "ArrowRight": return enabled[index === last ? 0 : index + 1];
    case "ArrowLeft": return enabled[index === 0 ? last : index - 1];
    case "Home": return enabled[0];
    case "End": return enabled[last];
    default: return undefined;
  }
}
