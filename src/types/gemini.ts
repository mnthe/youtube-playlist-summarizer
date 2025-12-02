export interface TimestampSection {
  timestamp: string; // "00:01:30" format - 섹션 시작 시점 (YouTube 링크용)
  seconds: number;
  screenshotTimestamp: string; // 핵심 슬라이드 시점 (스크린샷용)
  screenshotSeconds: number;
  title: string;
  content: string;
}

export interface VideoSummary {
  overview: string;
  sections: TimestampSection[];
  keyPoints: string[];
}
