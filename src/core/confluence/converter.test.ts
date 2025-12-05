import { describe, it, expect } from 'vitest';
import { MarkdownToConfluenceConverter } from './converter.js';

describe('MarkdownToConfluenceConverter', () => {
  const converter = new MarkdownToConfluenceConverter();

  describe('basic formatting', () => {
    it('converts headings', () => {
      const md = '# Heading 1\n## Heading 2\n### Heading 3';
      const result = converter.convert(md);
      expect(result).toContain('<h1>Heading 1</h1>');
      expect(result).toContain('<h2>Heading 2</h2>');
      expect(result).toContain('<h3>Heading 3</h3>');
    });

    it('converts bold text', () => {
      const md = 'This is **bold** text';
      const result = converter.convert(md);
      expect(result).toContain('<strong>bold</strong>');
    });

    it('converts italic text', () => {
      const md = 'This is *italic* text';
      const result = converter.convert(md);
      expect(result).toContain('<em>italic</em>');
    });

    it('converts inline code', () => {
      const md = 'Use `code` here';
      const result = converter.convert(md);
      expect(result).toContain('<code>code</code>');
    });

    it('converts code blocks', () => {
      const md = '```python\nprint("hello")\n```';
      const result = converter.convert(md);
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">python</ac:parameter>');
      expect(result).toContain('print("hello")');
    });

    it('converts horizontal rules', () => {
      const md = 'Before\n\n---\n\nAfter';
      const result = converter.convert(md);
      expect(result).toContain('<hr/>');
    });
  });

  describe('lists', () => {
    it('converts unordered lists', () => {
      const md = '- Item 1\n- Item 2\n- Item 3';
      const result = converter.convert(md);
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Item 1</li>');
      expect(result).toContain('<li>Item 2</li>');
      expect(result).toContain('<li>Item 3</li>');
      expect(result).toContain('</ul>');
    });

    it('converts ordered lists', () => {
      const md = '1. First\n2. Second\n3. Third';
      const result = converter.convert(md);
      expect(result).toContain('<ol>');
      expect(result).toContain('<li>First</li>');
      expect(result).toContain('<li>Second</li>');
      expect(result).toContain('</ol>');
    });

    it('converts nested lists', () => {
      const md = '- Parent\n  - Child 1\n  - Child 2\n- Another parent';
      const result = converter.convert(md);
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>Parent');
      expect(result).toContain('<li>Child 1</li>');
      expect(result).toContain('<li>Child 2</li>');
    });

    it('converts bold inside list items', () => {
      const md = '- **Bold item**\n- Normal item';
      const result = converter.convert(md);
      expect(result).toContain('<li><strong>Bold item</strong></li>');
      expect(result).toContain('<li>Normal item</li>');
    });

    it('converts links inside list items', () => {
      const md = '- [Link text](https://example.com)\n- Normal item';
      const result = converter.convert(md);
      expect(result).toContain('<li><a href="https://example.com">Link text</a></li>');
    });
  });

  describe('links', () => {
    it('converts regular links', () => {
      const md = '[Example](https://example.com)';
      const result = converter.convert(md);
      expect(result).toContain('<a href="https://example.com">Example</a>');
    });

    it('converts YouTube links to Smart Link block', () => {
      const md = '[Watch Video](https://www.youtube.com/watch?v=abc123def45)';
      const result = converter.convert(md);
      expect(result).toContain('data-card-appearance="block"');
      expect(result).toContain('https://www.youtube.com/watch?v=abc123def45');
      expect(result).toContain('<a href="https://www.youtube.com/watch?v=abc123def45" data-card-appearance="block">');
    });

    it('converts youtu.be short links to Smart Link block', () => {
      const md = '[Video](https://youtu.be/abc123def45)';
      const result = converter.convert(md);
      expect(result).toContain('data-card-appearance="block"');
      expect(result).toContain('abc123def45');
    });
  });

  describe('images', () => {
    it('converts local screenshot images', () => {
      const md = '![Alt text](./screenshots/00-30.png)';
      const result = converter.convert(md);
      expect(result).toContain('<ac:image ac:thumbnail="true" ac:width="600">');
      expect(result).toContain('<ri:attachment ri:filename="00-30.png"/>');
    });

    it('converts external images', () => {
      const md = '![Alt text](https://example.com/image.png)';
      const result = converter.convert(md);
      expect(result).toContain('<ac:image>');
      expect(result).toContain('<ri:url ri:value="https://example.com/image.png"/>');
    });
  });

  describe('frontmatter', () => {
    it('removes YAML frontmatter', () => {
      const md = '---\ntitle: "Test"\ndate: "2024-01-01"\n---\n\n# Content';
      const result = converter.convert(md);
      expect(result).not.toContain('title: "Test"');
      expect(result).not.toContain('---');
      expect(result).toContain('<h1>Content</h1>');
    });
  });

  describe('special handling', () => {
    it('normalizes literal \\n to newlines', () => {
      const md = 'Line 1\\nLine 2';
      const result = converter.convert(md);
      // After normalization, should be treated as separate lines or paragraph
      expect(result).not.toContain('\\n');
    });

    it('handles complex nested content', () => {
      const md = `## Summary

- **Point 1**: Description
  - Sub-point A
  - Sub-point B
- **Point 2**: Another description

### Details

1. First step
2. Second step`;

      const result = converter.convert(md);
      expect(result).toContain('<h2>Summary</h2>');
      expect(result).toContain('<strong>Point 1</strong>');
      expect(result).toContain('<li>Sub-point A</li>');
      expect(result).toContain('<h3>Details</h3>');
      expect(result).toContain('<ol>');
    });
  });

  describe('convertToIndexPage', () => {
    it('creates index page with video links in table format', () => {
      const videos = [
        { title: 'Video 1', pageId: '123', pageTitle: 'Video 1 Summary' },
        { title: 'Video 2', pageId: '456', pageTitle: 'Video 2 Summary' },
      ];
      const result = converter.convertToIndexPage('My Playlist', videos);

      expect(result).toContain('<h1>My Playlist</h1>');
      expect(result).toContain('총 2개 영상');
      expect(result).toContain('<table>');
      expect(result).toContain('<th>영상</th>');
      expect(result).toContain('<th>하위 페이지</th>');
      expect(result).toContain('ri:content-id="123"');
      expect(result).toContain('ri:content-title="Video 1 Summary"');
      expect(result).toContain('Video 1');
      expect(result).toContain('ri:content-id="456"');
    });

    it('escapes HTML in titles', () => {
      const videos = [
        {
          title: '<script>alert("xss")</script>',
          pageId: '123',
          pageTitle: '<script>alert("xss")</script>',
        },
      ];
      const result = converter.convertToIndexPage('Playlist', videos);

      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
    });
  });

  describe('large markdown rendering', () => {
    it('renders a complete video summary document', () => {
      const md = `---
title: "AWS re:Invent 2025 - Amazon Bedrock AgentCore Memory"
channel: "AWS Events"
published: "2025-01-15"
duration: "45:30"
url: "https://www.youtube.com/watch?v=Sh0Ro00_rpA"
summarized_at: "2025-12-03T10:00:00.000Z"
locale: "ko"
---

🎬 **[YouTube에서 보기](https://www.youtube.com/watch?v=Sh0Ro00_rpA)**

- **채널**: AWS Events
- **길이**: 45:30

---

## 요약

이 세션에서는 Amazon Bedrock AgentCore의 새로운 메모리 기능에 대해 다룹니다. 발표자는 AI 에이전트가 대화 컨텍스트를 유지하고 사용자 선호도를 학습하는 방법을 설명합니다.

### 주요 내용

#### [00:00] 소개 및 개요

![00-00](./screenshots/00-00.png)

AgentCore Memory는 AI 에이전트에게 지속적인 메모리를 제공하는 새로운 기능입니다.

- **세션 메모리**: 단기 대화 컨텍스트 유지
- **엔티티 메모리**: 사용자 정보 및 선호도 저장
- **지식 메모리**: RAG 기반 문서 검색

#### [05:30] 메모리 유형 상세 설명

![05-30](./screenshots/05-30.png)

세 가지 메모리 유형의 차이점:

1. **세션 메모리**
   - 단일 대화 세션 내에서만 유지
   - TTL 설정 가능 (기본 24시간)
   - 사용 예: 대화 흐름 유지

2. **엔티티 메모리**
   - 사용자별로 영구 저장
   - 선호도, 과거 상호작용 기록
   - 사용 예: 개인화된 추천

3. **지식 메모리**
   - 벡터 데이터베이스 연동
   - 문서 청킹 및 임베딩
   - 사용 예: FAQ 봇, 문서 검색

#### [15:00] 코드 예시

\`\`\`python
from bedrock_agentcore import AgentMemory, MemoryType

# 메모리 초기화
memory = AgentMemory(
    type=MemoryType.ENTITY,
    ttl=3600,
    max_items=1000
)

# 메모리 저장
await memory.store(
    key="user_preference",
    value={"theme": "dark", "language": "ko"}
)

# 메모리 조회
prefs = await memory.retrieve("user_preference")
\`\`\`

#### [25:00] 아키텍처 및 확장성

![25-00](./screenshots/25-00.png)

AgentCore Memory의 내부 아키텍처:

- **저장 계층**: DynamoDB + OpenSearch
- **캐싱**: ElastiCache for Redis
- **확장성**: 자동 샤딩 및 복제

> **참고**: 대규모 배포 시 VPC 엔드포인트 사용을 권장합니다.

#### [35:00] 베스트 프랙티스

메모리 사용 시 권장 사항:

| 항목 | 권장값 | 설명 |
|------|--------|------|
| TTL | 3600초 | 세션 메모리 기본값 |
| Max Items | 1000 | 엔티티당 최대 항목 |
| Chunk Size | 512 | 지식 메모리 청크 크기 |

---

## 핵심 포인트

- AgentCore Memory는 세션, 엔티티, 지식 세 가지 메모리 유형 제공
- 엔티티 메모리로 사용자별 개인화 가능
- DynamoDB와 OpenSearch 기반으로 확장성 확보
- TTL 설정으로 메모리 수명 관리
- VPC 엔드포인트로 보안 강화 가능`;

      const result = converter.convert(md);

      // Frontmatter should be removed
      expect(result).not.toContain('title: "AWS re:Invent');
      expect(result).not.toContain('---\ntitle');

      // YouTube Smart Link block should be present
      expect(result).toContain('data-card-appearance="block"');
      expect(result).toContain('Sh0Ro00_rpA');

      // Headers
      expect(result).toContain('<h2>요약</h2>');
      expect(result).toContain('<h3>주요 내용</h3>');
      expect(result).toContain('<h4>[00:00] 소개 및 개요</h4>');

      // Images as attachments
      expect(result).toContain('<ri:attachment ri:filename="00-00.png"/>');
      expect(result).toContain('<ri:attachment ri:filename="05-30.png"/>');

      // Lists with bold
      expect(result).toContain('<strong>세션 메모리</strong>');
      expect(result).toContain('<strong>엔티티 메모리</strong>');

      // Numbered lists
      expect(result).toContain('<ol>');
      expect(result).toContain('<li><strong>세션 메모리</strong>');

      // Nested list items
      expect(result).toContain('단일 대화 세션 내에서만 유지');

      // Code block
      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">python</ac:parameter>');
      expect(result).toContain('from bedrock_agentcore import');

      // Blockquote
      expect(result).toContain('<blockquote>');
      expect(result).toContain('VPC 엔드포인트 사용을 권장');

      // Table
      expect(result).toContain('<table>');
      expect(result).toContain('<th>항목</th>');
      expect(result).toContain('<td>3600초</td>');

      // Key points list
      expect(result).toContain('세션, 엔티티, 지식 세 가지 메모리 유형');
    });

    it('handles deeply nested lists', () => {
      const md = `- Level 1 Item A
  - Level 2 Item A1
    - Level 3 Item A1a
    - Level 3 Item A1b
  - Level 2 Item A2
- Level 1 Item B
  - Level 2 Item B1`;

      const result = converter.convert(md);

      expect(result).toContain('<li>Level 1 Item A');
      expect(result).toContain('<li>Level 2 Item A1');
      expect(result).toContain('<li>Level 3 Item A1a</li>');
      expect(result).toContain('<li>Level 3 Item A1b</li>');
      expect(result).toContain('<li>Level 1 Item B');

      // Should have nested ul tags
      const ulCount = (result.match(/<ul>/g) || []).length;
      expect(ulCount).toBeGreaterThanOrEqual(3);
    });

    it('handles mixed content with images in sections', () => {
      const md = `## Section 1

![Screenshot 1](./screenshots/01-00.png)

Some description text with **bold** and *italic*.

- Point 1
- Point 2

## Section 2

![Screenshot 2](./screenshots/02-00.png)

More content here.

\`\`\`javascript
const x = 1;
\`\`\``;

      const result = converter.convert(md);

      expect(result).toContain('<h2>Section 1</h2>');
      expect(result).toContain('<ri:attachment ri:filename="01-00.png"/>');
      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('<em>italic</em>');
      expect(result).toContain('<li>Point 1</li>');
      expect(result).toContain('<h2>Section 2</h2>');
      expect(result).toContain('<ri:attachment ri:filename="02-00.png"/>');
      expect(result).toContain('const x = 1');
    });

    it('handles multiple YouTube links in document', () => {
      const md = `## Related Videos

Watch the intro: [Intro Video](https://www.youtube.com/watch?v=video1abcdef)

And the follow-up: [Part 2](https://youtu.be/video2ghijkl)

Regular link: [Documentation](https://docs.example.com)`;

      const result = converter.convert(md);

      // Should have 2 YouTube Smart Link blocks
      const embedCount = (result.match(/data-card-appearance="block"/g) || []).length;
      expect(embedCount).toBe(2);

      expect(result).toContain('video1abcdef');
      expect(result).toContain('video2ghijkl');

      // Regular link should not be embedded
      expect(result).toContain('<a href="https://docs.example.com">Documentation</a>');
    });

    it('handles Korean content with special characters', () => {
      const md = `## 한글 제목 테스트

**굵은 글씨**와 *기울임* 테스트

- 항목 1: "따옴표" 테스트
- 항목 2: '작은따옴표' 테스트
- 항목 3: <특수문자> & 앰퍼샌드

\`코드: const 변수 = "값";\``;

      const result = converter.convert(md);

      expect(result).toContain('<h2>한글 제목 테스트</h2>');
      expect(result).toContain('<strong>굵은 글씨</strong>');
      expect(result).toContain('<em>기울임</em>');
      expect(result).toContain('"따옴표"');
      expect(result).toContain("'작은따옴표'");
      expect(result).toContain('<code>코드: const 변수 = "값";</code>');
    });

    it('handles long code blocks with special characters', () => {
      const md = `\`\`\`python
# Complex Python example
def process_data(items: list[dict]) -> dict:
    """
    Process items and return aggregated result.

    Args:
        items: List of dictionaries with 'value' key

    Returns:
        Aggregated statistics
    """
    result = {
        "count": len(items),
        "sum": sum(item["value"] for item in items),
        "special": "test <>&'\\""
    }

    # Handle edge cases
    if result["count"] == 0:
        return {"error": "No items"}

    return result

# Usage
data = [{"value": 1}, {"value": 2}]
print(process_data(data))  # {"count": 2, "sum": 3, ...}
\`\`\``;

      const result = converter.convert(md);

      expect(result).toContain('<ac:structured-macro ac:name="code">');
      expect(result).toContain('<ac:parameter ac:name="language">python</ac:parameter>');
      expect(result).toContain('<![CDATA[');
      expect(result).toContain('def process_data');
      expect(result).toContain('"""');
      expect(result).toContain('list[dict]');
    });
  });
});
