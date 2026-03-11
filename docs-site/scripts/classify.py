#!/usr/bin/env python3
"""
기술 분석 문서 자동 분류 엔진

project-analysis/ 디렉토리의 마크다운 파일을 규칙 기반 키워드 점수로 분류합니다.
LLM 없이 오프라인으로 동작하며, 빠르고 결정적인 결과를 제공합니다.

카테고리:
  - code-analysis (코드분석): 소스코드/파이프라인/아키텍처 분석
  - changes (수정내용): 변경사항, 수정이력, 리팩토링
  - design (설계문서): 설계 제안, 아키텍처/API 설계
  - troubleshooting (기술지원): 에러 분석, 디버깅, 문제해결
  - operations (운영가이드): 배포, 설정, 운영 절차
  - misc (기타): 분류 기준 미달

사용법:
  python classify.py              # 전체 분류 결과
  python classify.py --summary    # 카테고리별 요약
  python classify.py --json       # JSON 출력
"""

import argparse
import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_DIR = PROJECT_ROOT / "project-analysis"

CATEGORIES = {
    "code-analysis": {
        "label": "코드분석",
        "description": "소스코드 분석, 파이프라인 분석, 아키텍처 분석",
        "filename_keywords": [
            "analysis", "분석", "inspect", "review", "code",
            "pipeline", "파이프라인", "architecture", "아키텍처",
            "source", "소스", "implementation", "구현",
        ],
        "content_keywords": [
            "분석", "analysis", "소스코드", "source code",
            "파이프라인", "pipeline", "함수", "function",
            "클래스", "class", "모듈", "module",
            "호출", "call", "처리 흐름", "processing flow",
            "코드", "code", "구현", "implementation",
            "아키텍처", "architecture", "구조", "structure",
            "리뷰", "review", "inspect",
        ],
        "heading_keywords": [
            "분석", "처리 흐름", "파이프라인", "아키텍처",
            "코드", "구현", "모듈", "컴포넌트",
        ],
    },
    "changes": {
        "label": "수정내용",
        "description": "변경사항, 수정이력, 리팩토링 기록",
        "filename_keywords": [
            "change", "변경", "modify", "수정", "update", "업데이트",
            "refactor", "리팩토링", "migration", "마이그레이션",
            "patch", "패치", "fix", "수정", "changelog",
        ],
        "content_keywords": [
            "변경", "change", "수정", "modify", "업데이트", "update",
            "리팩토링", "refactor", "마이그레이션", "migration",
            "이전", "before", "이후", "after",
            "개선", "improve", "패치", "patch",
        ],
        "heading_keywords": [
            "변경", "수정", "업데이트", "리팩토링",
            "변경사항", "수정내용", "개선",
        ],
    },
    "design": {
        "label": "설계문서",
        "description": "설계 제안, 아키텍처 설계, API 설계",
        "filename_keywords": [
            "design", "설계", "proposal", "제안", "plan", "계획",
            "rfc", "spec", "specification", "명세",
            "blueprint", "schema", "스키마",
        ],
        "content_keywords": [
            "설계", "design", "제안", "proposal",
            "요구사항", "requirement", "명세", "specification",
            "인터페이스", "interface", "API",
            "다이어그램", "diagram", "플로우", "flow",
            "목표", "goal", "스키마", "schema",
        ],
        "heading_keywords": [
            "설계", "제안", "요구사항", "명세",
            "인터페이스", "API", "스키마",
        ],
    },
    "troubleshooting": {
        "label": "기술지원",
        "description": "에러 분석, 디버깅, 문제해결",
        "filename_keywords": [
            "error", "에러", "debug", "디버그", "troubleshoot",
            "issue", "이슈", "bug", "버그", "fix",
            "problem", "문제", "resolve", "해결",
        ],
        "content_keywords": [
            "에러", "error", "오류", "버그", "bug",
            "디버그", "debug", "문제", "problem",
            "해결", "resolve", "fix", "원인", "cause",
            "스택트레이스", "traceback", "예외", "exception",
            "실패", "fail", "장애", "incident",
        ],
        "heading_keywords": [
            "에러", "오류", "문제", "해결", "디버깅",
            "원인", "장애",
        ],
    },
    "operations": {
        "label": "운영가이드",
        "description": "배포, 설정, 운영 절차",
        "filename_keywords": [
            "deploy", "배포", "ops", "운영", "config", "설정",
            "setup", "셋업", "install", "설치",
            "guide", "가이드", "manual", "매뉴얼",
            "monitoring", "모니터링",
        ],
        "content_keywords": [
            "배포", "deploy", "운영", "operations",
            "설정", "config", "설치", "install",
            "가이드", "guide", "절차", "procedure",
            "모니터링", "monitoring", "서버", "server",
            "환경", "environment", "인프라", "infrastructure",
        ],
        "heading_keywords": [
            "배포", "설정", "설치", "운영",
            "가이드", "절차", "환경",
        ],
    },
}

# 점수 가중치
WEIGHT_FILENAME = 3.0
WEIGHT_HEADING = 2.0
WEIGHT_CONTENT = 1.0

# 최소 점수 임계값 (미만이면 "misc"로 분류)
MIN_SCORE_THRESHOLD = 2.0


def extract_headings(text: str) -> str:
    """마크다운 헤딩(#으로 시작하는 줄)을 추출"""
    headings = []
    for line in text.split("\n"):
        if line.strip().startswith("#"):
            headings.append(re.sub(r"^#+\s*", "", line.strip()))
    return " ".join(headings)


def score_category(filename: str, headings: str, content: str, cat_config: dict) -> float:
    """카테고리별 점수 계산"""
    score = 0.0
    filename_lower = filename.lower()
    headings_lower = headings.lower()
    content_lower = content.lower()

    # 파일명 키워드 매칭 (가중치 3.0)
    for kw in cat_config["filename_keywords"]:
        if kw.lower() in filename_lower:
            score += WEIGHT_FILENAME

    # 헤딩 키워드 매칭 (가중치 2.0)
    for kw in cat_config["heading_keywords"]:
        if kw.lower() in headings_lower:
            score += WEIGHT_HEADING

    # 콘텐츠 키워드 매칭 (가중치 1.0)
    for kw in cat_config["content_keywords"]:
        if kw.lower() in content_lower:
            score += WEIGHT_CONTENT

    return score


def classify_file(filepath: Path) -> dict:
    """단일 파일을 분류하여 결과 반환"""
    content = filepath.read_text(encoding="utf-8")
    headings = extract_headings(content)
    filename = filepath.stem  # 확장자 제외

    scores = {}
    for cat_id, cat_config in CATEGORIES.items():
        scores[cat_id] = score_category(filename, headings, content, cat_config)

    best_cat = max(scores, key=scores.get)
    best_score = scores[best_cat]

    if best_score < MIN_SCORE_THRESHOLD:
        best_cat = "misc"
        best_score = 0.0

    return {
        "file": filepath.name,
        "category": best_cat,
        "label": CATEGORIES.get(best_cat, {"label": "기타"})["label"],
        "score": best_score,
        "scores": scores,
    }


def classify_all() -> list[dict]:
    """project-analysis/ 디렉토리의 모든 MD 파일 분류"""
    if not SOURCE_DIR.exists():
        print(f"소스 디렉토리가 존재하지 않습니다: {SOURCE_DIR}", file=sys.stderr)
        return []

    md_files = sorted(SOURCE_DIR.glob("*.md"))
    if not md_files:
        print(f"마크다운 파일이 없습니다: {SOURCE_DIR}", file=sys.stderr)
        return []

    return [classify_file(f) for f in md_files]


def print_results(results: list[dict]) -> None:
    """분류 결과를 테이블 형태로 출력"""
    if not results:
        print("분류할 문서가 없습니다.")
        return

    print(f"\n{'파일명':<60} {'카테고리':<12} {'점수':>6}")
    print("-" * 80)
    for r in results:
        print(f"{r['file']:<60} {r['label']:<12} {r['score']:>6.1f}")
    print(f"\n총 {len(results)}개 문서")


def print_summary(results: list[dict]) -> None:
    """카테고리별 요약 출력"""
    if not results:
        print("분류할 문서가 없습니다.")
        return

    category_counts: dict[str, list[str]] = {}
    for r in results:
        cat = r["category"]
        if cat not in category_counts:
            category_counts[cat] = []
        category_counts[cat].append(r["file"])

    print(f"\n문서 분류 요약 (총 {len(results)}개)")
    print("=" * 50)

    # 정의된 카테고리 순서대로 출력
    all_cats = list(CATEGORIES.keys()) + ["misc"]
    for cat in all_cats:
        if cat in category_counts:
            label = CATEGORIES.get(cat, {"label": "기타"})["label"]
            files = category_counts[cat]
            print(f"\n{label} ({cat}): {len(files)}개")
            for f in files:
                print(f"  - {f}")


def main():
    parser = argparse.ArgumentParser(description="기술 분석 문서 자동 분류")
    parser.add_argument("--summary", action="store_true", help="카테고리별 요약 출력")
    parser.add_argument("--json", action="store_true", help="JSON 형식 출력")
    args = parser.parse_args()

    results = classify_all()

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    elif args.summary:
        print_summary(results)
    else:
        print_results(results)


if __name__ == "__main__":
    main()
