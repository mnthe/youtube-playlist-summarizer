# YouTube Playlist Summarizer

YouTube 재생목록을 Gemini(Vertex AI)로 분석하여 타임스탬프별 요약과 스크린샷이 포함된 마크다운 문서를 생성하는 CLI 도구입니다.

## 주요 기능

- **재생목록 전체 요약**: YouTube 재생목록 URL을 입력하면 모든 영상을 자동으로 분석
- **타임스탬프 기반 요약**: 주요 시점별로 내용을 구조화하여 정리
- **스크린샷 자동 캡처**: 각 타임스탬프에 해당하는 스크린샷 자동 추출
- **중단 후 재개**: 진행 상태를 저장하여 중단 후에도 이어서 처리 가능
- **새 영상 자동 감지**: 재생목록에 새 영상이 추가되면 자동으로 감지하여 처리
- **다국어 지원**: 요약 출력 언어 선택 가능 (한국어, 영어, 일본어, 중국어)

## 사전 요구사항

### 필수 설치

- **Node.js** v20 이상
- **yt-dlp**: 스크린샷 캡처용 ([설치 가이드](https://github.com/yt-dlp/yt-dlp#installation))
- **ffmpeg**: 프레임 추출용 ([설치 가이드](https://ffmpeg.org/download.html))

```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt install yt-dlp ffmpeg
```

### API 키 발급

1. **YouTube Data API v3**: [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com)에서 활성화
2. **Vertex AI (Gemini)**: [Google Cloud Console](https://console.cloud.google.com/vertex-ai)에서 활성화

## 설치

```bash
git clone https://github.com/mnthe/youtube-playlist-summarizer.git
cd youtube-playlist-summarizer
npm install
npm run build
```

## 환경 설정

`.env.example`을 복사하여 `.env` 파일을 생성하고 API 키를 입력합니다:

```bash
cp .env.example .env
```

```bash
# .env
YOUTUBE_API_KEY=your-youtube-api-key
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_CLOUD_LOCATION=us-central1
```

Google Cloud 인증:

```bash
gcloud auth application-default login
```

## 사용법

### 재생목록 요약

```bash
# 기본 사용
npm run dev -- --playlist "https://www.youtube.com/playlist?list=PLxxxxx"

# 옵션 지정
npm run dev -- \
  --playlist "https://www.youtube.com/playlist?list=PLxxxxx" \
  --locale ko \
  --output ./my-summaries
```

### 단일 영상 요약

```bash
npm run dev -- --video "https://www.youtube.com/watch?v=xxxxx" --locale ko
```

### 진행 상태 확인

```bash
npm run dev -- status --playlist "PLxxxxx"
```

### CLI 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-p, --playlist <url>` | 재생목록 URL | - |
| `-v, --video <url>` | 단일 영상 URL | - |
| `-l, --locale <locale>` | 출력 언어 (ko, en, ja, zh) | `ko` |
| `-o, --output <dir>` | 출력 디렉토리 | `./output` |
| `-c, --concurrency <n>` | 동시 처리 수 | `1` |
| `--no-screenshots` | 스크린샷 제외 | - |
| `-r, --retry <n>` | 재시도 횟수 | `3` |

## 출력 구조

```
output/
└── playlist-{id}/
    ├── state.json                 # 진행 상태
    ├── 01-video-title/
    │   ├── README.md              # 요약 마크다운
    │   └── screenshots/
    │       ├── 00-01-30.png
    │       └── 00-05-45.png
    ├── 02-another-video/
    │   ├── README.md
    │   └── screenshots/
    │       └── ...
    └── ...
```

### 마크다운 출력 예시

```markdown
---
title: "영상 제목"
channel: "채널명"
published: "2025-01-15"
duration: "15:30"
url: "https://www.youtube.com/watch?v=xxxxx"
---

## 영상 설명

원본 영상의 description...

---

## 요약

이 영상은 ... 에 대해 다루고 있습니다.

### 주요 내용

#### [00:01:30] 섹션 제목

![00:01:30](./screenshots/00-01-30.png)

해당 타임스탬프에서 다루는 내용...

---

## 핵심 포인트

- 포인트 1
- 포인트 2
```

## 개발

```bash
# 개발 모드 실행
npm run dev -- --help

# 빌드
npm run build

# 테스트
npm test
```

## 프로젝트 구조

```
src/
├── index.ts                    # CLI 진입점
├── types/                      # 타입 정의
├── core/                       # 비즈니스 로직
│   ├── youtube/               # YouTube API 클라이언트
│   ├── gemini/                # Vertex AI Gemini 클라이언트
│   ├── screenshot/            # yt-dlp + ffmpeg 스크린샷
│   ├── state/                 # 상태 관리
│   ├── output/                # 마크다운 생성
│   └── summarizer.ts          # 메인 오케스트레이터
└── adapters/
    └── cli/                   # CLI 어댑터 (Commander.js)
```

## 제한사항

- **공개 영상만 지원**: 비공개/미등록 영상은 Gemini에서 분석 불가
- **YouTube API 할당량**: 일일 할당량 제한 있음
- **Vertex AI 비용**: Gemini API 사용량에 따른 비용 발생

## 라이선스

ISC
