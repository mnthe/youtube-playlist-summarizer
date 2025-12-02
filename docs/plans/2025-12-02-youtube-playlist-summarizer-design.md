# YouTube Playlist Summarizer - 설계 문서

> 생성일: 2025-12-02

## 개요

YouTube 재생목록 URL을 받아 각 영상을 Gemini(Vertex AI)로 분석하고, 타임스탬프별 요약과 스크린샷이 포함된 마크다운 문서를 생성하는 CLI 도구.

## 요구사항

### 기능 요구사항

1. **재생목록 처리**: YouTube 재생목록 URL → 모든 영상 목록 추출
2. **영상 분석**: Gemini가 YouTube URL을 직접 분석 (Vertex AI)
3. **타임스탬프 요약**: 주요 시점별 내용 요약 생성
4. **스크린샷 캡처**: yt-dlp 부분 다운로드 + ffmpeg 프레임 추출 (기본 동작)
5. **마크다운 출력**: 영상별 폴더에 README.md + screenshots/
6. **상태 관리**: 중단 후 재실행 시 완료된 작업 스킵
7. **다국어 지원**: 출력 언어 지정 (--locale)

### 비기능 요구사항

- CLI 도구로 시작, 서버 확장 고려한 구조
- Node.js + TypeScript
- Core + Adapter 패턴으로 비즈니스 로직 분리

## 아키텍처

### Core + Adapter 패턴

```
src/
├── core/                  # 비즈니스 로직 (프레임워크 무관)
│   ├── summarizer.ts      # 메인 오케스트레이터
│   ├── youtube/
│   │   ├── client.ts      # YouTube Data API 래퍼
│   │   └── types.ts
│   ├── gemini/
│   │   ├── client.ts      # Vertex AI Gemini 래퍼
│   │   ├── prompts.ts     # 프롬프트 템플릿
│   │   └── types.ts
│   ├── screenshot/
│   │   ├── capturer.ts    # yt-dlp + ffmpeg
│   │   └── types.ts
│   ├── output/
│   │   ├── markdown.ts    # 마크다운 생성
│   │   └── templates.ts
│   └── state/
│       ├── manager.ts     # 상태 관리
│       └── types.ts
│
├── adapters/              # 진입점 어댑터
│   └── cli/
│       ├── index.ts       # CLI 진입점
│       ├── commands/
│       │   ├── summarize.ts
│       │   └── status.ts
│       └── utils.ts
│
└── types/                 # 공유 타입
    └── index.ts
```

### 데이터 흐름

```
1. CLI 명령어 실행
   $ yt-summarize --playlist URL --locale ko

2. YouTube API: 재생목록 → 영상 목록
   → videoId, title, channel, duration, description

3. 상태 확인: state.json + 폴더 존재 여부
   → 미완료 영상만 처리 대상

4. 영상별 처리:
   ├─ Step 1: Gemini 요약 → README.md 생성 + timestamps 추출
   └─ Step 2: yt-dlp + ffmpeg → 스크린샷 캡처 → 이미지 삽입

5. 상태 업데이트: state.json 저장
```

## 출력 구조

### 디렉토리

```
output/
└── playlist-{id}/
    ├── state.json
    │
    ├── 01-video-title/
    │   ├── README.md
    │   └── screenshots/
    │       ├── 00-01-30.png
    │       └── 00-05-45.png
    │
    ├── 02-another-video/
    │   ├── README.md
    │   └── screenshots/
    │       └── ...
    │
    └── ...
```

### 마크다운 형식

```markdown
---
title: "영상 제목"
channel: "채널명"
published: "2025-01-15"
duration: "15:30"
url: "https://www.youtube.com/watch?v=xxxxx"
summarized_at: "2025-12-02T10:05:00Z"
locale: "ko"
---

## 영상 설명

원본 영상의 description 내용

---

## 요약

이 영상은 ... 에 대해 다루고 있습니다.

### 주요 내용

#### [00:01:30] 섹션 제목

![00:01:30](./screenshots/00-01-30.png)

해당 타임스탬프에서 다루는 내용 요약...

#### [00:05:45] 다른 섹션 제목

![00:05:45](./screenshots/00-05-45.png)

해당 타임스탬프에서 다루는 내용 요약...

---

## 핵심 포인트

- 포인트 1
- 포인트 2
- 포인트 3
```

### 상태 파일 (state.json)

```json
{
  "playlistId": "PLxxxxxx",
  "playlistTitle": "재생목록 제목",
  "config": {
    "locale": "ko",
    "withScreenshots": true
  },
  "totalVideos": 25,
  "createdAt": "2025-12-02T10:00:00Z",
  "updatedAt": "2025-12-02T12:30:00Z",
  "videos": {
    "video-id-1": {
      "title": "영상 제목",
      "outputDir": "01-video-title",
      "summary": {
        "status": "completed",
        "completedAt": "2025-12-02T10:05:00Z",
        "timestamps": ["00:01:30", "00:05:45", "00:12:00"]
      },
      "screenshots": {
        "status": "completed",
        "total": 3,
        "completed": 3,
        "files": ["00-01-30.png", "00-05-45.png", "00-12-00.png"]
      }
    },
    "video-id-2": {
      "title": "영상 제목 2",
      "outputDir": "02-video-title-2",
      "summary": {
        "status": "completed",
        "timestamps": ["00:02:00", "00:08:30"]
      },
      "screenshots": {
        "status": "failed",
        "total": 2,
        "completed": 1,
        "files": ["00-02-00.png"],
        "error": "yt-dlp download failed for 00:08:30"
      }
    },
    "video-id-3": {
      "title": "영상 제목 3",
      "outputDir": "03-video-title-3",
      "summary": {
        "status": "pending"
      },
      "screenshots": {
        "status": "pending"
      }
    }
  }
}
```

## CLI 인터페이스

### 명령어

```bash
# 기본 사용법
$ yt-summarize --playlist "https://www.youtube.com/playlist?list=PLxxxxx"

# 전체 옵션
$ yt-summarize \
    --playlist "URL"           # (필수) 재생목록 URL
    --locale ko                # 출력 언어 (기본: en)
    --output ./my-output       # 출력 디렉토리 (기본: ./output)
    --concurrency 2            # 동시 처리 수 (기본: 1)
    --no-screenshots           # 스크린샷 제외
    --retry 3                  # 실패 시 재시도 횟수 (기본: 3)

# 상태 확인
$ yt-summarize status --playlist "URL"

# 실패한 것만 재시도
$ yt-summarize --playlist "URL" --retry-failed

# 단일 영상 처리
$ yt-summarize --video "https://www.youtube.com/watch?v=xxxxx" --locale ko
```

### 환경 변수

```bash
# .env
YOUTUBE_API_KEY=your-youtube-api-key

# Vertex AI
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=us-central1
# 인증: gcloud auth application-default login
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | Node.js (v20+) |
| 언어 | TypeScript |
| CLI 프레임워크 | Commander.js |
| YouTube API | @googleapis/youtube |
| Gemini | @google-cloud/vertexai |
| 스크린샷 | yt-dlp + ffmpeg (child_process) |
| 환경변수 | dotenv |
| 테스트 | Vitest |

## 제한사항 및 고려사항

### Gemini YouTube URL 처리

- **공개 영상만** 지원 (비공개/미등록 불가)
- 무료 티어: 하루 8시간 분량 제한
- Gemini 2.5+: 요청당 최대 10개 영상
- 영상당 263 tokens/second 소비

### 스크린샷 캡처

- yt-dlp + ffmpeg 외부 바이너리 필요
- `--download-sections` 옵션으로 부분 다운로드
- 저작권 고려 필요

### Rate Limiting

- YouTube Data API: 일일 할당량 관리
- Vertex AI: 분당 요청 제한 고려
- --concurrency 옵션으로 병렬 처리 조절

## 확장 계획

### 서버 어댑터 (향후)

```
src/adapters/server/
├── index.ts           # Express/Fastify 진입점
├── routes/
│   ├── summarize.ts   # POST /api/summarize
│   └── status.ts      # GET /api/status/:playlistId
└── middleware/
```

core/ 로직을 재사용하여 REST API 서버로 확장 가능.
