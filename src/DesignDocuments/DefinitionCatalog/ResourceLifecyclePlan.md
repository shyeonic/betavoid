# Resource Lifecycle Plan

이 문서는 샘플 코드의 타임스탬프 기반 자원 관리와 재생성 흐름을 현재 3D 월드 구조에 맞게 이식하기 위한 개발 계획서다.

## 1. 목표

- 자원 노드를 단순 초기 배치 데이터가 아니라 시간에 따라 소모, 만료, 재생성되는 월드 상태로 관리한다.
- 샘플 코드의 `resourceManager` 개념을 현재 IndexedDB 구조에 맞게 도입한다.
- `RESOURCE_DEFINITIONS`의 `total_capacity`, `spawn_limit_per_cycle`, `node_capacity_range`, `sector_ratio`, `lifetime_range` 값을 실제 런타임 로직에서 사용한다.
- 기존 개발 방침대로 legacy migration은 만들지 않는다. 테스트 빌드는 reset 후 실행하는 것을 전제로 한다.

## 2. 현재 상태

현재 구현은 다음까지만 반영되어 있다.

- 최초 월드 생성 시 `rss_001`~`rss_010` 자원 노드를 생성한다.
- 섹터 내부 자원은 `sector.resource_weights`에 따라 비례 배분한다.
- 섹터 외부 자원은 빈 청크에 배치한다.
- 각 자원 노드는 `spawn_time`을 가진다.
- `DECAYING` 자원은 `expiry_time`을 가진다.

아직 없는 흐름은 다음과 같다.

- 전역 자원 풀 상태
- `last_check`, `next_check`, `check_interval`
- 자원별 `current_total`, `pending_buffer`
- 만료 자원 제거
- 고갈 자원 제거
- 부족분만큼 주기적으로 자원 재생성
- `spawn_limit_per_cycle` 적용

## 3. 샘플 코드에서 가져올 핵심 개념

### 3.1 Resource Manager

샘플의 resource manager는 전역 자원 풀 상태를 가진다.

```js
{
  manager_id: "GLOBAL",
  last_check,
  next_check,
  check_interval,
  pools: {
    rss_001: {
      total_capacity,
      current_total,
      pending_buffer
    }
  }
}
```

현재 프로젝트에서는 별도 object store를 추가하기보다 `meta` store에 `key: "resourceManager"` 값으로 저장한다. 이렇게 하면 관리 대상이 단순하고, 현재 `meta` store의 사용 패턴과도 맞다.

### 3.2 자원 총량 계산

자원 총량은 현재 존재하는 resource node의 `current_amount` 합으로 계산한다.

추후 자원 시설이 자체 저장량을 갖게 되면 샘플처럼 시설의 `current_amount`도 합산할 수 있다. 현재 구현된 자원 시설은 원본 resource node를 소비해 건물로 바꾸지만 별도의 채굴 저장량을 아직 갖지 않으므로 이번 단계에서는 resource node 합산을 기준으로 한다.

### 3.3 주기적 체크

월드 로드 시점과 명시적 재생성 요청 시점에 다음 절차를 실행한다.

1. 현재 시간이 `resourceManager.next_check`보다 이전이면 아무 작업도 하지 않는다.
2. `expiry_time <= now`인 자원 노드를 제거한다.
3. `current_amount <= 0`인 자원 노드를 제거한다.
4. 자원별 현재 총량을 다시 계산한다.
5. `total_capacity - current_total + pending_buffer`를 재생성 후보량으로 계산한다.
6. 후보량이 0보다 크면 `spawn_limit_per_cycle` 이하로 잘라 새 노드를 생성한다.
7. 최소 노드 용량보다 작아서 생성하지 못한 잔여량은 `pending_buffer`로 남긴다.
8. `last_check = now`, `next_check = now + check_interval`로 갱신한다.

## 4. 현재 3D 구조에 맞춘 조정

### 4.1 공간 구조

샘플의 2D grid, sector size, global bounds는 사용하지 않는다.

현재 프로젝트는 다음 기준을 유지한다.

- `WORLD_CONFIG.chunkSize`
- `WORLD_CONFIG.chunkGrid`
- `WORLD_CONFIG.sectorSize`
- `chunk.global_bounds`
- `sector.global_bounds`

자원 재생성 위치는 이미 구현된 3D 배치 함수들을 재사용한다.

- 섹터 내부: `pickPositionInSector`
- 섹터 외부: `pickPositionOutsideSectors`
- 섹터별 배분: `calculateSectorResourceAllocations`
- 노드 생성: `createResourceNodesForQuota`

### 4.2 결정론과 타임스탬프

최초 월드 생성은 seed 기반 난수를 사용한다. 그러나 시간 경과 재생성은 샘플처럼 현재 시각에 의해 발생하는 월드 이벤트다.

이번 단계에서는 `world seed + now + cycle index` 기반의 seeded random을 만들어 재생성 결과가 한 cycle 안에서는 안정적으로 생성되도록 한다.

### 4.3 DB 저장 방식

이번 단계에서 새 store는 추가하지 않는다.

- `resourceNodes`: 기존 store 사용
- `meta/world`: 기존 월드 메타
- `meta/resourceManager`: 신규 전역 자원 풀 상태

DB version은 꼭 필요하지 않으면 올리지 않는다. 단, 현재 테스트 빌드는 reset 전제이므로 구조 충돌이 생기면 version을 올려도 migration은 만들지 않는다.

## 5. 구현 순서

### 5.1 Resource Manager 생성

- `createResourceManager(createdAt)` 추가
- 모든 `RESOURCE_DEFINITIONS`에 대해 pool 초기화
- 최초 월드 생성 후 실제 생성된 resource node 기준으로 `current_total` 계산
- `next_check = createdAt + check_interval`
- 기본 `check_interval = 86400000`

### 5.2 Snapshot에 Resource Manager 포함

- `getWorldSnapshot()`이 `resourceManager`를 포함하도록 수정
- `replaceWorldData()`가 resource manager를 저장하도록 수정
- `clearWorld()`와 reset 흐름에서 함께 초기화되도록 확인

### 5.3 재생성 체크 API 추가

- `loadOrCreateWorld()`에서 기존 월드를 로드한 뒤 `checkAndSpawnResources()` 실행
- `checkAndSpawnResources({ force = false } = {})` 추가
- `force`가 true이면 `next_check`와 무관하게 즉시 실행
- 실행 후 snapshot을 다시 로드하거나 메모리 snapshot을 갱신

### 5.4 제거 로직

- `removeExpiredResourceNodes(now, resourceNodes)` 추가
- `removeEmptyResourceNodes(resourceNodes)` 추가
- DB에는 삭제된 node를 반영한다.

### 5.5 재생성 로직

- 자원별 pool 현재 총량을 계산한다.
- 부족분을 `spawn_limit_per_cycle` 이하로 제한한다.
- `createResourceNodesForQuota()`를 재사용하되, 재생성 cycle 전용 seed/rng를 주입한다.
- 생성된 node는 DB와 snapshot에 반영한다.
- 생성하지 못한 잔여량은 `pending_buffer`에 저장한다.

### 5.6 검증

- 정의 카탈로그 검증이 계속 통과해야 한다.
- 최초 생성 시 자원 pool의 `current_total`이 resource node 합과 일치해야 한다.
- `force` 재생성 시 `next_check`가 갱신되어야 한다.
- `expiry_time`이 지난 노드는 제거되어야 한다.
- `current_amount <= 0` 노드는 제거되어야 한다.
- 부족분이 있을 때 `spawn_limit_per_cycle` 이하의 자원만 새로 생성되어야 한다.
- legacy ID가 다시 생성되지 않아야 한다.

## 6. 이번 단계에서 하지 않을 것

- 기존 DB 데이터 migration
- legacy ID alias
- 자원 채굴 UI와 생산/창고 시스템 전체 연결
- 자원 시설의 내부 저장량/생산 tick 구현
- 샘플의 2D 공간 규격 이식
- 별도 resourceManager object store 추가

## 7. 완료 기준

- 새 월드 생성 후 `snapshot.resourceManager`가 존재한다.
- 각 자원 pool이 `rss_001`~`rss_010` 기준으로 생성된다.
- 로드 시점에 시간이 지났다면 만료/고갈 자원이 정리되고 부족분이 재생성된다.
- `spawn_limit_per_cycle`, `pending_buffer`, `next_check`가 실제 로직에 사용된다.
- 브라우저 reset 실행에서 월드가 정상 로드되고 스캐너 자원 목록이 유지된다.
