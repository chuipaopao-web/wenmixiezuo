import type { StoryEventContent } from "@wenmi/contracts";

export type StoryEventCarryKind = "opening" | "actual" | "planned";

export type StoryEventPresentation = {
  carryLabel: string;
  carryText: string;
  hook: string;
  predicament: string;
  choice: string;
  endpoint: string;
};

function clean(parts: Array<string | undefined>, fallback: string) {
  const values = parts.map((part) => part?.trim()).filter(Boolean) as string[];
  return values.length > 0 ? values.join("；") : fallback;
}

export function buildStoryEventPresentation(input: {
  content: StoryEventContent;
  previousContent?: StoryEventContent | null;
  carryKind: StoryEventCarryKind;
}): StoryEventPresentation {
  const { content, previousContent, carryKind } = input;
  const actualCarry = clean(
    [content.startingState],
    "上一幕留下的变化还没有写清楚。",
  );
  const plannedCarry = clean(
    [previousContent?.requiredResult, content.startingState],
    "这一幕预计从上一事件的结果继续。",
  );

  return {
    carryLabel:
      carryKind === "opening"
        ? "本卷开场"
        : carryKind === "actual"
          ? "上一幕（已发生）"
          : "预计承接",
    carryText:
      carryKind === "opening"
        ? actualCarry
        : carryKind === "actual"
          ? actualCarry
          : plannedCarry,
    hook: clean([content.trigger], "新的麻烦正在逼近。"),
    predicament: clean(
      [content.startingState, content.trigger, ...(content.obstacles ?? [])],
      "人物眼前的麻烦还需要继续设计。",
    ),
    choice: clean(
      content.choicesAndCosts ?? [],
      "人物还没有被逼到必须选择的时刻。",
    ),
    endpoint: clean(
      [content.requiredResult, content.characterArcImpact, content.nextEventImpact],
      "这一幕的结果和下一步麻烦还需要继续设计。",
    ),
  };
}

export function StoryEventNodeCard(props: {
  title: string;
  order: number;
  status: string;
  presentation: StoryEventPresentation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`story-event-node-card${props.selected ? " is-active" : ""}`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <small>
        事件 {props.order} · {props.status}
      </small>
      <strong>{props.title}</strong>
      <span>{props.presentation.hook}</span>
      <em>{props.presentation.carryLabel}：{props.presentation.carryText}</em>
    </button>
  );
}

export function StoryCausalLink(props: {
  from: StoryEventContent;
  to: StoryEventContent;
  actual: boolean;
}) {
  const cause = props.actual
    ? props.to.startingState || props.from.requiredResult
    : props.from.requiredResult || props.to.startingState;
  const effect = props.to.trigger || props.to.volumeResponsibility;

  return (
    <div className={`story-causal-link${props.actual ? " is-actual" : ""}`}>
      <small>{props.actual ? "已经发生" : "预计承接"}</small>
      <span>因为{cause || "上一幕留下了变化"}，所以{effect || "新的麻烦被推到人物面前"}</span>
    </div>
  );
}

export function StoryEventPreview(props: {
  presentation: StoryEventPresentation;
  compact?: boolean;
}) {
  const { presentation } = props;
  return (
    <div className={`story-event-preview${props.compact ? " compact" : ""}`}>
      <section className="story-event-carry">
        <small>{presentation.carryLabel}</small>
        <p>{presentation.carryText}</p>
      </section>
      <section className="story-event-beat">
        <small>眼前的麻烦</small>
        <p>{presentation.predicament}</p>
      </section>
      <section className="story-event-beat">
        <small>不得不作出的选择</small>
        <p>{presentation.choice}</p>
      </section>
      <section className="story-event-beat">
        <small>这一幕会走到哪里</small>
        <p>{presentation.endpoint}</p>
      </section>
    </div>
  );
}
