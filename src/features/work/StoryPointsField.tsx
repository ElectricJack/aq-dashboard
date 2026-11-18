import { MAX_STORY_POINTS } from "../../api/adapters/storyPoints";

export function StoryPointsField({ value, onChange }: { value: string; onChange?: (value: string) => void }) {
  return <label>Story points
    <input type="number" inputMode="numeric" min={1} max={MAX_STORY_POINTS} step={1} placeholder="Unestimated"
      value={value} onChange={onChange ? event => onChange(event.target.value) : undefined} readOnly={!onChange} />
  </label>;
}
