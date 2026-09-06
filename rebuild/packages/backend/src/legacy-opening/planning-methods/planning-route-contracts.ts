export interface V7PlanningRouteVolume {
  order: number;
  title: string;
  direction: string;
  protagonistChange: string;
  mainPressure: string;
  readerPayoff: string;
  targetWords: number;
  handoff: string;
}

export interface V7PlanningStoryRoute {
  schema: 'v7-planning-story-route-v1';
  routeTitle: string;
  oneLinePromise: string;
  publicSummary: string;
  readingExperience: string;
  protagonistJourney: string;
  targetWords: number;
  targetVolumes: number;
  commercialAudience: string;
  retentionPositioning: string;
  volumeRoadmap: V7PlanningRouteVolume[];
  firstVolumeFocus: string[];
  sellingPoints: string[];
  risks: string[];
  openQuestions: string[];
}
