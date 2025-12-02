export interface TimestampSection {
  timestamp: string; // "00:01:30" format
  seconds: number;
  title: string;
  content: string;
}

export interface VideoSummary {
  overview: string;
  sections: TimestampSection[];
  keyPoints: string[];
}
