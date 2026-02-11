#!/usr/bin/env python3
"""
MkDocs 설정 동적 생성기

classify.py의 분류 결과를 기반으로:
1. project-analysis/*.md → docs-site/docs/{카테고리}/ 로 복사
2. docs-site/docs/index.md 자동 생성 (문서 현황 랜딩페이지)
3. docs-site/mkdocs.yml 생성 (Material 테마, 한국어, 다크모드)

사용법:
  python generate_config.py
"""

import re
import shutil
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import yaml

# classify.py를 임포트하기 위해 경로 추가
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from classify import CATEGORIES, classify_all  # noqa: E402

PROJECT_ROOT = SCRIPT_DIR.parent.parent
DOCS_SITE_DIR = SCRIPT_DIR.parent
DOCS_DIR = DOCS_SITE_DIR / "docs"
SOURCE_DIR = PROJECT_ROOT / "project-analysis"


def fix_markdown(text: str) -> str:
    """MkDocs 호환성을 위한 마크다운 자동 보정

    Python-Markdown은 블록 요소 사이에 빈 줄이 필요합니다.
    코드블록/테이블/리스트/헤딩 전후로 빈 줄이 없으면 렌더링이 깨집니다.
    """
    lines = text.split("\n")
    result = []
    in_code_block = False

    # 블록 요소 시작 패턴: 테이블, 리스트, 헤딩, 인용, admonition
    block_start_re = re.compile(
        r"^(\|"           # 테이블 행
        r"|[-*+] "        # 비순서 리스트
        r"|\d+\. "        # 순서 리스트
        r"|#{1,6} "       # 헤딩
        r"|>"             # 인용
        r"|!!! "          # admonition
        r")"
    )

    for i, line in enumerate(lines):
        stripped = line.strip()

        # 코드블록 토글
        if stripped.startswith("```"):
            if in_code_block:
                # 코드블록 닫힘 → 다음 줄이 빈 줄이 아니고 블록 요소면 빈 줄 삽입
                in_code_block = False
                result.append(line)
                if (i + 1 < len(lines)
                        and lines[i + 1].strip()
                        and block_start_re.match(lines[i + 1].strip())):
                    result.append("")
                continue
            else:
                # 코드블록 시작 → 이전 줄이 빈 줄이 아니면 빈 줄 삽입
                in_code_block = True
                if result and result[-1].strip():
                    result.append("")
                result.append(line)
                continue

        if in_code_block:
            result.append(line)
            continue

        # 테이블 시작 전에 빈 줄 보장 (이전 줄이 테이블이 아니고 비어있지도 않은 경우)
        if stripped.startswith("|") and result:
            prev = result[-1].strip()
            if prev and not prev.startswith("|"):
                result.append("")

        # 헤딩 전에 빈 줄 보장
        if re.match(r"^#{1,6} ", stripped) and result:
            prev = result[-1].strip()
            if prev:
                result.append("")

        result.append(line)

    return "\n".join(result)


def copy_with_fix(src: Path, dst: Path) -> None:
    """마크다운 파일을 자동 보정 후 복사"""
    content = src.read_text(encoding="utf-8")
    fixed = fix_markdown(content)
    dst.write_text(fixed, encoding="utf-8")


def prepare_docs_directory(results: list[dict]) -> dict[str, list[dict]]:
    """분류 결과에 따라 docs/ 디렉토리 구조를 생성하고 파일을 복사 (자동 보정 포함)"""
    # 기존 docs/ 정리
    if DOCS_DIR.exists():
        shutil.rmtree(DOCS_DIR)
    DOCS_DIR.mkdir(parents=True)

    # 카테고리별 그룹핑
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in results:
        grouped[r["category"]].append(r)

    # 파일 복사 (자동 보정 적용)
    for cat, files in grouped.items():
        cat_dir = DOCS_DIR / cat
        cat_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            src = SOURCE_DIR / f["file"]
            dst = cat_dir / f["file"]
            copy_with_fix(src, dst)

    return dict(grouped)


def generate_index(grouped: dict[str, list[dict]], total: int) -> None:
    """docs/index.md 랜딩 페이지 생성"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        "# LightRAG 기술 문서",
        "",
        f"> 마지막 생성: {now} | 총 {total}개 문서",
        "",
        "## 문서 현황",
        "",
        "| 카테고리 | 문서 수 | 설명 |",
        "|----------|---------|------|",
    ]

    # 정의된 카테고리 순서대로
    all_cats = list(CATEGORIES.keys()) + ["misc"]
    for cat in all_cats:
        if cat in grouped:
            label = CATEGORIES.get(cat, {"label": "기타"})["label"]
            desc = CATEGORIES.get(cat, {"description": "분류 기준 미달 문서"})["description"]
            count = len(grouped[cat])
            lines.append(f"| [{label}]({cat}/) | {count} | {desc} |")

    lines.extend([
        "",
        "## 최근 문서",
        "",
    ])

    # 최근 5개 문서 (파일명 기준 역순 정렬)
    all_files = []
    for cat, files in grouped.items():
        for f in files:
            all_files.append((f["file"], cat, f["label"]))
    all_files.sort(key=lambda x: x[0], reverse=True)

    for filename, cat, label in all_files[:5]:
        lines.append(f"- [{filename}]({cat}/{filename}) ({label})")

    lines.append("")

    index_path = DOCS_DIR / "index.md"
    index_path.write_text("\n".join(lines), encoding="utf-8")


def build_nav(grouped: dict[str, list[dict]]) -> list:
    """MkDocs nav 구조 생성"""
    nav = [{"홈": "index.md"}]

    all_cats = list(CATEGORIES.keys()) + ["misc"]
    for cat in all_cats:
        if cat in grouped:
            label = CATEGORIES.get(cat, {"label": "기타"})["label"]
            items = []
            for f in sorted(grouped[cat], key=lambda x: x["file"], reverse=True):
                # 파일명에서 날짜 제거하여 제목으로 사용
                title = f["file"].replace(".md", "")
                items.append({title: f"{cat}/{f['file']}"})
            nav.append({label: items})

    return nav


def generate_mkdocs_yml(nav: list) -> None:
    """mkdocs.yml 설정 파일 생성"""
    config = {
        "site_name": "LightRAG 기술 문서",
        "site_description": "LightRAG 프로젝트 기술 분석 및 설계 문서",
        "docs_dir": "docs",
        "site_dir": "site",
        "theme": {
            "name": "material",
            "language": "ko",
            "font": {
                "text": "Noto Sans KR",
                "code": "JetBrains Mono",
            },
            "palette": [
                {
                    "scheme": "default",
                    "primary": "indigo",
                    "accent": "indigo",
                    "toggle": {
                        "icon": "material/brightness-7",
                        "name": "다크 모드로 전환",
                    },
                },
                {
                    "scheme": "slate",
                    "primary": "indigo",
                    "accent": "indigo",
                    "toggle": {
                        "icon": "material/brightness-4",
                        "name": "라이트 모드로 전환",
                    },
                },
            ],
            "features": [
                "navigation.instant",
                "navigation.tracking",
                "navigation.sections",
                "navigation.expand",
                "navigation.top",
                "search.suggest",
                "search.highlight",
                "content.code.copy",
                "toc.follow",
            ],
        },
        "markdown_extensions": [
            "admonition",
            "pymdownx.details",
            "pymdownx.superfences",
            {"pymdownx.highlight": {"anchor_linenums": True}},
            "pymdownx.inlinehilite",
            "pymdownx.tabbed",
            "tables",
            {"toc": {"permalink": True}},
        ],
        "nav": nav,
    }

    yml_path = DOCS_SITE_DIR / "mkdocs.yml"
    with open(yml_path, "w", encoding="utf-8") as f:
        f.write("# 자동 생성 파일 - 직접 편집하지 마세요\n")
        f.write(f"# 생성일: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    print(f"생성됨: {yml_path}")


def main():
    print("문서 분류 중...")
    results = classify_all()

    if not results:
        print("분류할 문서가 없습니다. 종료합니다.")
        return

    print(f"{len(results)}개 문서 분류 완료")

    print("docs/ 디렉토리 준비 중...")
    grouped = prepare_docs_directory(results)

    print("index.md 생성 중...")
    generate_index(grouped, len(results))

    print("mkdocs.yml 생성 중...")
    nav = build_nav(grouped)
    generate_mkdocs_yml(nav)

    # 결과 요약
    print("\n분류 결과:")
    all_cats = list(CATEGORIES.keys()) + ["misc"]
    for cat in all_cats:
        if cat in grouped:
            label = CATEGORIES.get(cat, {"label": "기타"})["label"]
            print(f"  {label}: {len(grouped[cat])}개")

    print(f"\n총 {len(results)}개 문서 → docs-site/docs/ 준비 완료")


if __name__ == "__main__":
    main()
