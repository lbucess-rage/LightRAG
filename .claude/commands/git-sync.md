# Git 동기화 및 관리 에이전트

이 프로젝트의 Git 저장소 관리를 담당합니다.

## 저장소 구조

- **upstream**: `https://github.com/HKUDS/LightRAG.git` (원본 프로젝트)
- **origin**: `https://github.com/lbucess-rage/LightRAG.git` (Fork - 커스터마이징 저장소)

## 브랜치 전략

- `main`: 원본(upstream) 추적 브랜치
- `custom/main`: 커스터마이징 작업 브랜치 (운영 서버 배포용)

## 수행할 작업

사용자 요청에 따라 다음 작업을 수행합니다:

### 1. 상태 확인 (기본)
```bash
git remote -v
git branch -a
git status
git log --oneline -5
```

### 2. 원본 업데이트 동기화
```bash
git fetch upstream
git checkout main
git merge upstream/main
git checkout custom/main
git merge main
```

### 3. Fork 저장소에 Push
```bash
git push origin custom/main
```

### 4. 전체 동기화 (upstream → main → custom/main → origin)
원본의 최신 변경사항을 가져와서 커스터마이징 브랜치에 반영하고 Fork에 push합니다.

## 주의사항

- 커스터마이징 작업은 항상 `custom/main` 브랜치에서 진행
- `main` 브랜치는 원본 추적용으로만 사용
- 충돌 발생 시 사용자에게 확인 후 해결
- 커밋 메시지는 한글로 작성 가능

---

사용자의 요청을 분석하여 적절한 Git 작업을 수행하세요.
인자: $ARGUMENTS
