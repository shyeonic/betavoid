# PBDD: World Object Render Optimization

***본 문서는 `DesignDocuments/00_Guide.md`의 하위 문서이며, 개발 후 기획서(PBDD)로 현재 코드에 존재하는 구현을 기준으로 작성한다.***

## 1. 목적

월드 오브젝트 렌더링 최적화 작업의 현재 구현 상태와 의사결정 결과를 기록한다.

이 문서의 대상은 `WorldMapManager`가 월드 데이터 스냅샷을 Three.js 오브젝트로 변환하고, 플레이어 주변 청크의 자원/건물 오브젝트를 렌더링하는 방식이다.

## 2. 관련 코드

- `js/worldDefinitions.js`
  - `WORLD_CONFIG.renderChunkRadius`
- `js/WorldMapManager.js`
  - visible chunk 계산
  - chunk bounds 렌더링
  - sector bounds 렌더링
  - 자원/건물 mesh 생성 큐
  - visible chunk diff 기반 추가/제거
- `js/GameManager.js`
  - running 이전 상태의 `WorldMapManager.update()` 호출

## 3. 현재 구현 요약

### 3.1 렌더 청크 범위

현재 월드 렌더링은 플레이어가 위치한 청크를 중심으로 `renderChunkRadius = 2` 범위의 청크를 대상으로 한다.

3D 청크 공간이므로 후보 범위는 최대 `5 x 5 x 5 = 125`개 청크이다. 실제 visible chunk 집합은 `chunksById`에 존재하는 청크만 포함한다.

### 3.2 오브젝트 생성 큐

자원과 건물 오브젝트는 visible chunk 계산 시 즉시 모두 생성하지 않는다.

`WorldMapManager`는 다음 상태를 사용해 생성 작업을 분산한다.

- `objectBuildQueue`: 생성 대기 중인 자원/건물 작업 목록
- `pendingObjectKeys`: 같은 오브젝트가 중복 큐잉되는 것을 막는 key 집합
- `objectBuildBatchSize = 8`: 한 프레임에서 처리할 최대 작업 수
- `objectBuildBudgetMs = 3`: 한 프레임에서 오브젝트 생성에 사용할 목표 시간 예산

큐 작업은 `kind`, `key`, `chunkId`, `data`를 가진다. 처리 시점에 해당 `chunkId`가 더 이상 visible 상태가 아니면 mesh를 만들지 않고 폐기한다.

### 3.3 로딩/준비 화면 중 큐 처리

`GameManager.animate()`는 게임이 `running` 상태가 아니어도 `worldMapManager.update(dt)`를 호출한다.

이 덕분에 월드 데이터가 로딩되어 큐가 만들어진 뒤, Start 버튼을 누르기 전 준비 화면에서도 오브젝트 생성 큐가 소화된다. 결과적으로 실제 플레이 진입 시점의 순간 부하를 줄인다.

### 3.4 기본 화면 요소 우선 안정화

현재 구현은 Three.js 렌더 순서를 별도 pass로 강제하는 방식이 아니라, 무거운 월드 오브젝트 생성 작업을 뒤로 미루는 방식으로 기본 화면 요소의 안정성을 확보한다.

기본 화면 요소는 다음 흐름으로 먼저 준비된다.

- `GameManager.setupScene()`의 scene background와 fog
- `GameManager.setupWorld()`의 조명과 star layers
- `GameManager.addShipModel()`로 배치되는 플레이어 함선
- `WorldMapManager.renderVisibleWorld()`에서 즉시 반영되는 sector/chunk bounds

반면 자원/건물 mesh는 `objectBuildQueue`에 등록되어 프레임 예산에 따라 순차 생성된다. 따라서 배경, 격자, 함선은 자원/건물 mesh 생성 비용에 덜 묶이며 먼저 안정적으로 표시될 수 있다.

### 3.5 visible chunk diff 갱신

visible chunk가 바뀔 때 전체 `objectsGroup`을 비우고 다시 만드는 방식은 사용하지 않는다.

현재 구현은 이전 visible chunk 집합과 다음 visible chunk 집합을 비교한다.

- 제거된 chunk:
  - 해당 chunk의 sector bounds 제거
  - 해당 chunk의 자원/건물 오브젝트 제거
  - 해당 chunk에 속한 회전 애니메이션 항목 제거
  - 해당 chunk의 미처리 queue 작업 제거
- 추가된 chunk:
  - 해당 chunk의 sector bounds 추가
  - 해당 chunk의 자원/건물 오브젝트 생성 작업을 queue에 등록
- 유지된 chunk:
  - 기존 bounds와 오브젝트를 그대로 유지

`force` 갱신 시에는 visible 렌더 상태를 먼저 비운 뒤 새 visible set을 기준으로 다시 등록한다. 이는 같은 위치에서 강제 갱신이 발생할 때 오브젝트가 중복 생성되는 것을 막는다.

## 4. 주요 의사결정

### 4.1 Three.js layers가 아니라 작업 큐로 해결

렌더링 문제를 Three.js `layers`로 분리하지 않았다.

`layers`는 카메라와 raycaster의 표시/선택 필터링에는 유용하지만, 많은 오브젝트를 한 프레임에 생성하는 비용을 줄이지는 못한다. 이번 최적화의 핵심 병목은 렌더 순서가 아니라 mesh 생성과 group 재구성 비용이므로 작업 큐와 diff 갱신을 우선 적용했다.

### 4.2 타겟팅 프레임은 범위 제외

타겟팅 프레임은 `TargetingOverlay`의 2D canvas overlay로 구현되어 있으며 WebGL scene 내부 오브젝트가 아니다.

따라서 오브젝트 렌더 queue, visible chunk diff, Three.js material 정책과 직접 경쟁하지 않는다. 이번 최적화 범위에서도 타겟팅 프레임은 제외했다.

### 4.3 `objectsGroup`은 flat 구조 유지

chunk별 group을 새로 만들지 않고 `objectsGroup.children`에 자원/건물 root object를 직접 유지한다.

현재 `GameManager`의 선택 로직은 `objectsGroup.children`을 raycaster와 fallback selection의 입력으로 사용한다. chunk group을 중간에 넣으면 선택 루프와 visible object 탐색을 함께 바꿔야 하므로, 이번 최적화에서는 flat 구조를 유지하고 `userData.chunk_id` 기준으로 제거한다.

### 4.4 bounds는 즉시, 무거운 오브젝트는 지연

sector/chunk bounds는 화면 맥락을 제공하는 가벼운 line object이므로 visible chunk 변경 시 바로 반영한다.

자원/건물 mesh는 모델 clone, geometry/material clone, material 적용이 포함되어 상대적으로 무겁기 때문에 queue로 지연 생성한다.

### 4.5 렌더 순서 보장이 아니라 작업 부하 분산

이번 최적화는 배경, 격자, 함선을 WebGL 최상위 레이어로 강제 렌더링하는 결정이 아니다.

의사결정의 핵심은 기본 화면을 구성하는 요소는 즉시 준비하고, 상대적으로 무거운 자원/건물 mesh 생성만 queue로 분산하는 것이다. 즉, 화면상 깊이 관계나 material 정렬을 바꾸기보다 초기 프레임과 chunk 전환 시점의 작업량을 줄여 안정성을 확보한다.

## 5. 검증된 동작

현재 구현은 다음 조건에서 검증되었다.

- `renderChunkRadius = 2` 상태에서 visible chunk가 125개로 계산됨
- 오브젝트 생성 queue와 pending set이 0까지 정상 소화됨
- 강제 visible rebuild 시 오브젝트 중복 생성이 발생하지 않음
- 인접 chunk로 visible range를 변경했을 때 제거/추가 흐름이 정상 동작함
- `node --check` 기준 관련 JavaScript 파일 문법 오류 없음

브라우저 검증 중 WebGL `ReadPixels` 성능 경고가 관찰될 수 있으나, 이는 현재 오브젝트 queue 구현의 JavaScript 오류가 아니라 renderer/browser 측 경고로 분류한다.

## 6. 현재 제약

- queue 처리 값은 고정값이다.
  - `objectBuildBatchSize = 8`
  - `objectBuildBudgetMs = 3`
- 자원/건물 타입별 `InstancedMesh`는 아직 적용하지 않았다.
- geometry/material 공유 최적화는 아직 적용하지 않았다.
- 원거리 오브젝트 LOD나 placeholder 승격 시스템은 아직 없다.
- 선택된 오브젝트를 queue 앞쪽으로 승격하는 정책은 아직 없다.

## 7. 후속 후보

- 실제 표시 오브젝트 수가 더 커질 경우 batch/budget 값을 설정화한다.
- 선택 또는 항법 대상 오브젝트를 queue 앞쪽으로 이동하는 우선순위 정책을 추가한다.
- 개발용 디버그 패널에 visible chunk 수, object count, queue length를 표시한다.
- 반복되는 자원/건물 타입이 많아지면 `InstancedMesh` 적용을 검토한다.
- 원거리 오브젝트에 저비용 placeholder 또는 LOD 체계를 도입한다.
