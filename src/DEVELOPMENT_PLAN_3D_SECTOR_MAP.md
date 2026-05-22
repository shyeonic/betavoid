# 3D Sector Map Initial Placement Development Plan

## 1. Goal

`sample-beta_haze.html`의 섹터/자원/건물 데이터 구조를 현재 3D 게임 구조에 맞게 이식한다.

이번 작업의 핵심 목표는 다음으로 제한한다.

- 글로벌 3D 좌표 기준의 섹터 판정 구조 도입
- 글로벌 3D 좌표를 청크 단위로 인덱싱하는 좌표 체계 도입
- 초기 우주 맵의 일회성 랜덤 배치
- `rss` 폴더의 3D 모델을 이용한 자원/건물 시각화
- 초기 환경설정 팝업 내부에 게임 데이터 관리 UI 추가
- 동일 모델을 공유하더라도 데이터 인스턴스는 서로 다르게 관리

이번 작업에서 제외한다.

- 함선 항해 시스템 확장
- 주기적 자원 재생성
- 자원 채굴, 생산, 거래, 스케줄, 큐 시스템
- NPC 함선/전투/작전 타깃
- 복잡한 경제/세력/인벤토리 로직

즉, 이번 단계는 “3D 공간에 데이터 기반으로 자원과 건물을 한 번 생성하고, 그것을 보고 검증하고 초기화할 수 있는 최소 기반”을 만드는 작업이다.

## 2. Sample Code Findings

### 2.1 Sector Layout

샘플의 섹터 생성은 `generateSectorLayout(sectorTemplates)`가 담당한다.

동작 요약:

- 섹터 템플릿 개수 `N`을 기준으로 맵 그리드 크기 `L`을 계산한다.
- 계산식은 `L = floor(sqrt(5 * N)) + 2`이다.
- 각 섹터의 샘플 평면 크기는 `SECTOR_SIZE = 10000`이다.
- 3D 버전에서는 같은 값을 `x/y/z` 기본 부피 크기로 확장하거나, 축별 크기 `{ x, y, z }`를 따로 둔다.
- 외곽 테두리 셀을 제외한 그리드 셀들을 후보로 만들고 Fisher-Yates 방식으로 섞는다.
- 섞인 셀을 섹터 템플릿에 배정한다.
- 각 섹터는 `global_bounds`를 가진다.

샘플 섹터 데이터 형태:

```js
{
  sector_id: "SEC-001",
  name: "EPSILON PRIME",
  theme: "Volcanic_Industrial",
  grid_size: { width: 200, height: 200 },
  stats: { ... },
  resource_weights: { rss_001: 5, rss_002: 15 },
  global_bounds: {
    min: { x: 10000, y: 20000 },
    max: { x: 20000, y: 30000 }
  }
}
```

3D 확장 후 섹터 데이터 형태:

```js
{
  sector_id: "SEC-001",
  name: "EPSILON PRIME",
  theme: "Volcanic_Industrial",
  grid_size: { width: 200, height: 200, depth: 200 },
  stats: { ... },
  resource_weights: { gas1: 1, gas2: 1, ore1: 4, ore2: 4, water1: 2, water2: 2 },
  global_bounds: {
    min: { x: 10000, y: 20000, z: 30000 },
    max: { x: 20000, y: 30000, z: 40000 }
  }
}
```

현재 3D 게임은 `THREE.Vector3` 좌표계를 사용하므로, 샘플의 2D 섹터 구조를 그대로 평면에 올리는 것이 아니라 3차원 부피 섹터로 확장한다.

확장 원칙:

- 샘플의 `global_bounds.min/max.x`는 3D `x` 축 범위로 유지한다.
- 샘플의 `global_bounds.min/max.y`는 3D `y` 축 범위로 유지한다.
- 새로 `global_bounds.min/max.z`를 추가해 3D `z` 축 범위를 만든다.
- 자원과 건물의 `position`은 항상 `{ x, y, z }`를 가진다.
- 오브젝트를 `z = 0` 또는 특정 평면에 고정하지 않고, 섹터 부피 안에서 3축 모두 랜덤 분산 배치한다.

### 2.2 Sector Detection

샘플은 `getSectorAtPosition(x, y)`로 글로벌 좌표가 어느 섹터의 경계 안에 있는지 판정한다.

핵심 규칙:

- `x >= sector.global_bounds.min.x`
- `x <= sector.global_bounds.max.x`
- `y >= sector.global_bounds.min.y`
- `y <= sector.global_bounds.max.y`

3D 적용 시에는 함선 또는 오브젝트의 `x, y, z`를 모두 기준으로 판정한다.

```js
getSectorAtPosition(x, y, z)
```

따라서 3D 섹터 판정 규칙은 다음처럼 확장한다.

- `x >= sector.global_bounds.min.x`
- `x <= sector.global_bounds.max.x`
- `y >= sector.global_bounds.min.y`
- `y <= sector.global_bounds.max.y`
- `z >= sector.global_bounds.min.z`
- `z <= sector.global_bounds.max.z`

샘플의 `global_bounds` 구조는 유지하되, 3D 전용 필드 `z`를 추가한다. 더 이상 `y`를 `z`로 재해석하지 않는다.

### 2.3 Coordinate Chunking

현재 개발 계획에는 섹터 부피와 글로벌 3D 좌표는 들어 있었지만, 모든 좌표를 청크화하는 명시적 설계는 없었다. 이 아이디어는 3D 우주 맵과 잘 맞으므로 이번 계획에 추가한다.

권장 개념:

- 섹터는 월드의 큰 구역이다.
- 청크는 좌표 인덱싱, 로딩, 컬링, 근접 검색을 위한 작은 3D 격자 단위다.
- 모든 자원/건물/향후 함선/오브젝트는 글로벌 좌표 `{ x, y, z }`를 원본으로 가진다.
- 동시에 해당 좌표에서 파생한 `chunk`와 `local_position`을 가진다.

권장 청크 크기:

```js
chunkSize: {
  x: 1000,
  y: 1000,
  z: 1000
}
```

청크 좌표 계산:

```js
chunk = {
  x: Math.floor(position.x / chunkSize.x),
  y: Math.floor(position.y / chunkSize.y),
  z: Math.floor(position.z / chunkSize.z)
};

local_position = {
  x: position.x - chunk.x * chunkSize.x,
  y: position.y - chunk.y * chunkSize.y,
  z: position.z - chunk.z * chunkSize.z
};
```

청크 ID:

```js
chunk_id = `${chunk.x}:${chunk.y}:${chunk.z}`;
```

이번 단계의 결정:

- 원본 좌표는 계속 글로벌 `{ x, y, z }`로 저장한다.
- `chunk`, `chunk_id`, `local_position`은 파생 인덱스 필드로 함께 저장한다.
- 위치 수정이 생기는 미래 작업에서는 글로벌 좌표를 먼저 갱신하고, 청크 필드를 다시 계산한다.
- 이번 작업에서는 동적 청크 로딩까지 구현하지 않는다. 초기 배치 오브젝트의 청크 인덱싱과 데이터 구조만 만든다.

### 2.4 Database Structure

샘플은 IndexedDB에 다음 저장소를 둔다.

- `sectors`
- `resourceNodes`
- `resourceManager`
- `buildings`
- `settings`
- 그 외 ships, queues, actions, schedules 등

이번 3D 작업에서는 최소 저장소만 사용한다.

- `sectors`
- `chunks`
- `resourceNodes`
- `buildings`
- `settings`
- `meta` 또는 `worldState`

`resourceManager`, 큐, 액션, 스케줄은 이번 범위에서 제외한다. 또한 현재 개발 중인 3D 코드에서는 자원/건물 ID에 게임 내 의미를 부여하지 않는다. `gas1`, `hq1` 같은 값은 샘플 배치와 모델 연결을 위한 중립 식별자이며, 실제 표시 이름과 세계관상 의미는 추후 다국어 지원/i18n 데이터에서 별도로 붙인다.

### 2.5 Resource Generation

샘플의 자원 생성 핵심은 다음이다.

- `RESOURCE_DEFINITIONS`에 자원 종류별 총량, 노드 용량, 섹터 배치 비율, 수명, 초당 채굴량 등이 정의된다.
- `calculateSectorAllocations(resourceType, totalAmount)`가 섹터별 `resource_weights`를 이용해 분배량을 계산한다.
- `createResourceNode(type, capacity, sectorId)`가 실제 자원 노드 데이터를 만든다.
- 샘플의 `position`은 섹터 내부 2D 랜덤 좌표이거나, 섹터 밖 UNKNOWN 좌표가 된다.
- 3D 버전에서는 이 규칙을 `{ x, y, z }` 3축 랜덤 좌표로 확장한다.

이번 작업에서는 복잡한 총량 분배 대신 샘플 배치용 자원 종류 6개만 생성한다. 이 6개는 현재 코드에서 의미성 이름을 갖지 않는 중립 식별자다.

샘플 자원 종류:

- `gas1`
- `gas2`
- `ore1`
- `ore2`
- `water1`
- `water2`

대상 자원 모델:

- `rss/ore_planets/gas_01.obj`
- `rss/ore_planets/ore_01.obj`
- `rss/ore_planets/water_01.obj`

모델 매핑:

- `gas1`, `gas2` -> `gas_01`
- `ore1`, `ore2` -> `ore_01`
- `water1`, `water2` -> `water_01`

생성 수량:

- `gas1`, `gas2`, `ore1`, `ore2`, `water1`, `water2` 각각 1개
- 총 6개 자원 인스턴스

각 인스턴스는 같은 모델을 공유하더라도 별도 데이터 ID, 용량, 좌표, 섹터, 생성 시각을 가진다. 현재 단계에서는 `name`, `description`, `displayName` 같은 의미성 필드를 넣지 않는다. 필요하다면 추후 `i18n_key` 또는 별도 localization 테이블로 연결한다.

### 2.6 Building Generation

샘플의 건물 생성은 `createBuildingInstance(buildingId, sectorId, position, gridX, gridY, resourceNodeId, polityId)`가 담당한다.

핵심 필드:

- `building_instance_id`
- `building_id`
- `sector_id`
- `position`
- `grid_position`
- `resource_node_id`
- `hp`
- `status`
- `created_at`
- `dock_capacity`
- `inventory`

이번 3D 작업에서는 건물 모델이 `hq_01` 하나뿐이므로, 샘플 건물 종류 2개를 같은 모델에 매핑한다. 이 역시 현재 코드에서 의미를 부여하지 않는 중립 식별자다.

대상 건물 키:

- `hq1`
- `hq2`

대상 건물 모델:

- `rss/buildings/hq_01.obj`

생성 수량:

- `hq1`, `hq2` 각각 1개
- 총 2개 건물 인스턴스

`hq1`, `hq2`는 모두 `hq_01.obj`를 사용한다. 현재 단계에서는 둘을 세계관상 다른 건물로 해석하지 않는다. 시각적 구분이 필요하면 디버깅용 tint/scale 정도만 사용하고, 이름과 역할은 추후 다국어/게임 디자인 데이터에서 정의한다.

## 3. Current 3D Code Findings

### 3.1 Current File Responsibilities

현재 구조:

- `index.html`: DOM, HUD, 시작 화면, 설정 팝업, import map
- `js/main.js`: `GameManager` 생성 및 초기화
- `js/GameManager.js`: Three.js 렌더러, 씬, 함선, 카메라, 입력, 게임 루프
- `js/ResourceManager.js`: OBJ 로드, 오디오/버퍼 로드, 로딩 진행 상태
- `js/UIManager.js`: 시작 화면, 키 바인딩 설정, HUD, 토스트
- `js/SoundManager.js`: 오디오 재생
- `js/config.js`: 게임 설정, 키 바인딩, 에셋 경로

### 3.2 Current Constraints

현재 `ResourceManager`는 `OBJLoader`만 사용하고, 로드한 모델의 material을 `MeshStandardMaterial`로 교체한다.

`rss`에는 `.mtl`도 존재하지만 현재 로더 구조에서는 `.mtl`을 사용하지 않는다. 최소 구현을 유지하려면 이번 작업에서도 OBJ만 로드하고, 샘플 키별 material/tint를 코드에서 부여하는 편이 낫다.

### 3.3 Current Settings Popup

현재 설정 팝업은 `start-settings-panel` 안에 다음 구조로 되어 있다.

- 헤더
- `keyBindingList`
- 푸터의 Reset 버튼

사용자 요구는 다음 구조다.

환경설정 -> 메뉴 팝업 -> `[키 바인딩, 데이터 관리 등 병렬적 배치]`

따라서 설정 팝업 내부에 탭 또는 병렬 메뉴 구조를 추가한다.

권장 구조:

- 상단: Settings 제목 + 닫기
- 메뉴 영역: `Key Binding`, `Data`
- 콘텐츠 영역:
  - Key Binding 탭: 기존 키 바인딩 UI
  - Data 탭: 현재 월드 데이터 요약, 재생성, 초기화 버튼
- 하단: 현재 탭에 맞는 액션 버튼

## 4. Proposed Architecture

### 4.1 New Modules

최소한의 책임 분리를 위해 다음 파일을 추가한다.

```text
js/WorldDataManager.js
js/WorldMapManager.js
```

선택적으로 설정값이 커질 경우 다음도 추가할 수 있다.

```text
js/worldDefinitions.js
```

권장 구현은 `worldDefinitions.js`를 따로 두는 것이다. 데이터 정의와 런타임 관리 코드가 분리되어 이후 확장이 쉽다.

최종 권장 파일 구조:

```text
js/worldDefinitions.js
js/WorldDataManager.js
js/WorldMapManager.js
```

### 4.2 worldDefinitions.js

정적 정의를 둔다.

포함 항목:

- 섹터 템플릿
- 섹터 크기
- 리소스 키 정의
- 건물 키 정의
- 초기 배치 수량
- 모델 에셋 ID 매핑

예상 구조:

```js
export const WORLD_CONFIG = {
  dbName: "void-zero-world",
  dbVersion: 1,
  sectorSize: {
    x: 10000,
    y: 10000,
    z: 10000
  },
  chunkSize: {
    x: 1000,
    y: 1000,
    z: 1000
  },
  sectorCount: 4,
  randomSeedKey: "void-zero-world-seed"
};

export const SECTOR_TEMPLATES = [
  {
    sector_id: "SEC-001",
    name: "EPSILON PRIME",
    theme: "Industrial",
    resource_weights: {
      gas1: 1,
      gas2: 1,
      ore1: 4,
      ore2: 4,
      water1: 2,
      water2: 2
    }
  }
];

export const RESOURCE_DEFINITIONS = {
  gas1: {
    resource_id: "gas1",
    model_id: "gas_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2.0,
    visual: {
      scale: 220,
      color: 0x9adfbd
    }
  },
  gas2: {
    resource_id: "gas2",
    model_id: "gas_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2.0,
    visual: {
      scale: 220,
      color: 0x9adfbd
    }
  },
  ore1: {
    resource_id: "ore1",
    model_id: "ore_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2.0,
    visual: {
      scale: 220,
      color: 0xb29daf
    }
  },
  ore2: {
    resource_id: "ore2",
    model_id: "ore_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2.0,
    visual: {
      scale: 220,
      color: 0xb29daf
    }
  },
  water1: {
    resource_id: "water1",
    model_id: "water_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2.0,
    visual: {
      scale: 220,
      color: 0x74c7ff
    }
  },
  water2: {
    resource_id: "water2",
    model_id: "water_01",
    total_capacity_range: [1800, 4200],
    base_yield_per_sec: 2.0,
    visual: {
      scale: 220,
      color: 0x74c7ff
    }
  }
};

export const BUILDING_DEFINITIONS = {
  hq1: {
    building_id: "hq1",
    model_id: "hq_01",
    hp: 5000,
    visual: {
      scale: 120,
      color: 0xffffff
    }
  },
  hq2: {
    building_id: "hq2",
    model_id: "hq_01",
    hp: 5000,
    visual: {
      scale: 120,
      color: 0xd8ecff
    }
  }
};
```

모델 스케일 주의:

- `gas1`, `gas2`, `ore1`, `ore2`, `water1`, `water2`, `hq1`, `hq2`는 현재 단계에서 표시 이름이 아니다.
- 이 ID들은 저장/배치/모델 매핑을 위한 안정적인 키다.
- 사용자에게 보이는 이름은 추후 `locales/ko.json`, `locales/en.json` 같은 다국어 리소스나 별도 `NAME_DEFINITIONS`에서 붙인다.

주의:

- 실제 Three.js 모델 스케일은 OBJ 원본 크기에 따라 튜닝이 필요하다.
- 현재 함선 모델은 `normalizeModel()`로 길이 6 기준 정규화한다.
- 월드 오브젝트는 함선보다 멀리 보이게 해야 하므로 별도 normalize 함수와 목표 크기를 둔다.

### 4.3 WorldDataManager.js

데이터 생성과 저장을 담당한다.

주요 책임:

- IndexedDB 열기
- object store 생성
- 기존 월드 데이터 로드
- 최초 실행 시 월드 데이터 생성
- 월드 데이터 초기화
- 월드 데이터 재생성
- 데이터 요약 반환

저장소:

```text
sectors
chunks
resourceNodes
buildings
meta
settings
```

각 저장소 key:

- `sectors`: `sector_id`
- `chunks`: `chunk_id`
- `resourceNodes`: `resource_instance_id`
- `buildings`: `building_instance_id`
- `meta`: `key`
- `settings`: `key`

월드 데이터 스냅샷 형태:

```js
{
  sectors: [],
  chunks: [],
  resourceNodes: [],
  buildings: [],
  meta: {
    seed,
    generated_at,
    version
  }
}
```

주요 메서드:

```js
async init()
async loadOrCreateWorld()
async createNewWorld({ seed } = {})
async resetWorld()
async getWorldSnapshot()
async getSummary()
getSectorAtPosition(x, y, z)
getChunkAtPosition(x, y, z)
getChunkIdAtPosition(x, y, z)
```

### 4.4 WorldMapManager.js

3D 씬에 월드 오브젝트를 배치한다.

주요 책임:

- 자원/건물 OBJ 모델 로드
- 같은 모델을 쓰는 인스턴스끼리 원본 모델 캐싱
- 월드 데이터 스냅샷을 기반으로 씬 오브젝트 생성
- 섹터 경계 시각화
- 오브젝트 정리 및 재렌더링
- 향후 클릭/선택/라벨 확장을 위한 `userData` 부여

주요 메서드:

```js
async loadAssets(resourceManager)
renderWorld(snapshot)
clearWorld()
createResourceMesh(resourceNode)
createBuildingMesh(building)
createSectorBounds(sector)
dispose()
```

인스턴스 오브젝트의 `userData`:

```js
{
  kind: "resource",
  id: "RES-GAS1-...",
  type: "gas1",
  model_id: "gas_01",
  sector_id: "SEC-001"
}
```

건물:

```js
{
  kind: "building",
  id: "BLD-HQ1-...",
  building_id: "hq1",
  model_id: "hq_01",
  sector_id: "SEC-002"
}
```

### 4.5 ResourceManager Extension

현재 `ResourceManager`는 함선 전용 `loadShipModel()`만 가진다.

추가할 기능:

```js
async loadObjModel(id, source, options = {})
normalizeWorldModel(object, targetSize, materialOptions)
```

`ASSETS`에는 다음을 추가한다.

```js
worldModels: {
  gas_01: new URL("../rss/ore_planets/gas_01.obj", import.meta.url).href,
  ore_01: new URL("../rss/ore_planets/ore_01.obj", import.meta.url).href,
  water_01: new URL("../rss/ore_planets/water_01.obj", import.meta.url).href,
  hq_01: new URL("../rss/buildings/hq_01.obj", import.meta.url).href
}
```

최소 구현에서는 `.mtl`을 생략하고 코드에서 material을 부여한다.

## 5. Data Model Detail

### 5.1 Sector

```js
{
  sector_id: "SEC-001",
  name: "EPSILON PRIME",
  theme: "Industrial",
  resource_weights: {
    gas1: 1,
    gas2: 1,
    ore1: 4,
    ore2: 4,
    water1: 2,
    water2: 2
  },
  global_bounds: {
    min: { x: 10000, y: 10000, z: 10000 },
    max: { x: 20000, y: 20000, z: 20000 }
  },
  chunk_bounds: {
    min: { x: 10, y: 10, z: 10 },
    max: { x: 19, y: 19, z: 19 }
  },
  created_at: 1779292800000
}
```

3D 해석:

- `global_bounds.min.x`는 3D X 최소값
- `global_bounds.min.y`는 3D Y 최소값
- `global_bounds.min.z`는 3D Z 최소값
- `global_bounds.max.x`는 3D X 최대값
- `global_bounds.max.y`는 3D Y 최대값
- `global_bounds.max.z`는 3D Z 최대값

샘플의 2D 섹터는 사각형이었지만, 3D 버전의 섹터는 축 정렬 박스, 즉 AABB 부피로 취급한다.

`chunk_bounds`는 섹터가 포함하는 청크 범위다. `global_bounds.max`가 경계값이므로, 청크 최대값은 `floor((max - 1) / chunkSize)`로 계산해 닫힌 범위처럼 다룬다.

### 5.2 Chunk

```js
{
  chunk_id: "12:18:15",
  position: { x: 12, y: 18, z: 15 },
  global_bounds: {
    min: { x: 12000, y: 18000, z: 15000 },
    max: { x: 13000, y: 19000, z: 16000 }
  },
  sector_id: "SEC-001",
  object_counts: {
    resources: 1,
    buildings: 0
  },
  created_at: 1779292800000
}
```

이번 단계에서 `chunks` 저장소는 필수 런타임 로딩 단위가 아니라 인덱싱/검증용 메타 데이터다. 향후 동적 월드 로딩, 섹터 내부 스캔, 근접 오브젝트 검색이 들어오면 청크 단위가 실제 로딩 단위가 된다.

### 5.3 Resource Node

```js
{
  resource_instance_id: "RES-GAS1-1779292800000-a1b2c3",
  type: "gas1",
  model_id: "gas_01",
  sector_id: "SEC-001",
  chunk_id: "12:18:15",
  chunk: { x: 12, y: 18, z: 15 },
  position: { x: 12450, y: 18220, z: 15680 },
  local_position: { x: 450, y: 220, z: 680 },
  total_capacity: 3200,
  current_amount: 3200,
  base_yield_per_sec: 2.0,
  spawn_time: 1779292800000,
  created_at: 1779292800000
}
```

렌더링 시에는 데이터 좌표를 그대로 3D 좌표로 사용하되, 필요하면 렌더 스케일만 곱한다.

```js
mesh.position.set(position.x, position.y, position.z)
```

따라서 `y`는 더 이상 2D 평면 좌표가 아니라 실제 수직/공간 축이다. 오브젝트는 섹터 부피 내부에서 `x`, `y`, `z` 모두 다른 값을 가질 수 있다.

### 5.4 Building

```js
{
  building_instance_id: "BLD-HQ1-1779292800000-a1b2c3",
  building_id: "hq1",
  model_id: "hq_01",
  sector_id: "SEC-001",
  chunk_id: "15:14:11",
  chunk: { x: 15, y: 14, z: 11 },
  position: { x: 15300, y: 14600, z: 11200 },
  local_position: { x: 300, y: 600, z: 200 },
  hp: 5000,
  status: "active",
  created_at: 1779292800000
}
```

`hq2` 예시:

```js
{
  building_instance_id: "BLD-HQ2-1779292800000-a1b2c3",
  building_id: "hq2",
  model_id: "hq_01",
  sector_id: "SEC-002",
  chunk_id: "25:31:28",
  chunk: { x: 25, y: 31, z: 28 },
  position: { x: 25200, y: 31800, z: 28750 },
  local_position: { x: 200, y: 800, z: 750 },
  hp: 5000,
  status: "active",
  created_at: 1779292800000
}
```

현재 단계에서는 건물 역할, 생산 로직, 표시 이름을 두지 않는다. `hq1`, `hq2`는 샘플 월드에 배치되는 두 건물 데이터 키이며, 실제 이름과 역할은 추후 다국어/게임 데이터 레이어에서 결정한다.

## 6. Initial Placement Rules

### 6.1 Sector Creation

최소 섹터 수는 4개로 시작한다.

추천 섹터:

- `SEC-001`: Epsilon Prime, `ore1`/`ore2` 가중치 높음
- `SEC-002`: Nova Station, 건물 배치 중심
- `SEC-003`: Azure Nebula, `gas1`/`gas2` 가중치 높음
- `SEC-004`: Frost Frontier, `water1`/`water2` 가중치 높음

샘플의 10개 섹터를 그대로 가져오지 않는 이유:

- 이번 목표가 최소 구현이다.
- 3D 모델 10개 이상 배치 전 섹터/좌표/DB/렌더링 연결 검증이 먼저다.
- 추후 섹터 템플릿 수만 늘리면 확장 가능해야 한다.

### 6.2 Resource Placement

총 6개 생성:

```text
gas1   x 1
gas2   x 1
ore1   x 1
ore2   x 1
water1 x 1
water2 x 1
```

배치 규칙:

- 각 자원 키는 해당 가중치가 높은 섹터를 우선 선택한다.
- 같은 모델 그룹의 두 키, 예를 들어 `gas1`과 `gas2`, `ore1`과 `ore2`, `water1`과 `water2`는 가능하면 서로 다른 섹터에 둔다.
- 섹터의 `x`, `y`, `z` 경계에서 각각 800 유닛 이상 떨어진 위치를 사용한다.
- 기존 오브젝트와 3D 유클리드 거리 기준 최소 거리 `1200` 이상을 유지한다.
- 실패 시 최대 40회 재시도 후 섹터 중심에서 3축 랜덤 오프셋을 사용한다.
- 같은 모델 그룹의 두 자원이 같은 평면이나 같은 깊이에 나란히 놓이지 않도록 `x/y/z`를 모두 다르게 분산한다.
- 최종 좌표가 정해지면 `chunk`, `chunk_id`, `local_position`을 계산해 함께 저장한다.

### 6.3 Building Placement

총 2개 생성:

```text
hq1 x 1
hq2 x 1
```

배치 규칙:

- `hq1`, `hq2`는 우선적으로 서로 다른 섹터에 하나씩 배치한다.
- 현재 단계에서는 `hq1`, `hq2`에 역할 차이를 두지 않는다.
- 건물끼리 3D 유클리드 거리 기준 최소 거리 `1600` 이상을 유지한다.
- 자원과 건물 사이 3D 유클리드 거리 기준 최소 거리 `800` 이상을 유지한다.
- 같은 `hq_01` 모델을 쓰지만 디버깅 가시성을 위해 필요하면 인스턴스별 material tint와 scale을 약하게 다르게 둔다.
- 건물도 특정 평면에 고정하지 않고 섹터 부피 안에 배치한다. 단, 시각적으로 너무 산만해지지 않도록 같은 섹터의 건물은 섹터 중심부 근처의 완만한 3D 클러스터로 둔다.
- 최종 좌표가 정해지면 `chunk`, `chunk_id`, `local_position`을 계산해 함께 저장한다.

### 6.4 Deterministic Option

데이터 관리 UI에서 `Regenerate`를 누를 때마다 새 랜덤 배치가 생성된다.

추후 디버깅 편의를 위해 seed 기반 랜덤을 넣는 것이 좋다.

이번 작업에서 권장:

- `createNewWorld({ seed })` 인자 지원
- seed가 없으면 `Date.now()` 사용
- 생성된 seed를 `meta.seed`에 저장

간단한 seeded random 함수는 외부 라이브러리 없이 구현한다.

## 7. 3D Visual Plan

### 7.1 Scale

샘플의 섹터 크기 `10000`을 3축 모두에 그대로 쓰면 현재 함선 카메라 거리 `10~60` 대비 너무 크다.

선택지는 두 가지다.

1. 데이터 좌표는 3D 글로벌 좌표로 크게 유지하고, 렌더링 좌표에 scale factor 적용
2. 데이터 좌표와 렌더링 좌표를 동일하게 쓰되 카메라/항해 스케일을 크게 조정

권장안은 1번이다.

```js
const WORLD_RENDER_SCALE = 0.01;
```

예:

- 데이터 좌표 `{ x: 10000, y: 10000, z: 10000 }` -> 렌더 좌표 `{ x: 100, y: 100, z: 100 }`
- 섹터 크기 `{ x: 10000, y: 10000, z: 10000 }` -> 화면상 `{ x: 100, y: 100, z: 100 }`
- 함선 속도/카메라 현재 설정과 더 잘 맞음

주의:

- HUD 좌표는 데이터 좌표를 보여줄지 렌더 좌표를 보여줄지 결정해야 한다.
- 이번 작업에서는 함선의 실제 `THREE` 위치를 데이터 좌표로 보기보다 “비행용 렌더 좌표”로 유지하고, 섹터 판정 시 역스케일 변환하는 방식을 권장한다.

```js
dataX = renderX / WORLD_RENDER_SCALE
dataY = renderY / WORLD_RENDER_SCALE
dataZ = renderZ / WORLD_RENDER_SCALE
```

### 7.2 Sector Bounds Rendering

섹터 경계는 3D 부피를 드러내는 와이어프레임 박스로 표시한다.

구현 옵션:

- `THREE.LineSegments`
- `THREE.BufferGeometry`
- 각 섹터의 `global_bounds.min/max.x/y/z`를 이용해 12개 모서리 라인을 생성한다.

각 섹터:

- 직육면체 경계 라인
- 중앙에 아주 작은 marker 또는 label은 추후 작업

이번 구현에서는 텍스트 라벨은 생략한다. Three.js 텍스트/HTML 라벨은 UI 복잡도가 올라가므로, 데이터 관리 UI에서 목록으로 확인한다.

### 7.3 Resource Model Rendering

모델별 권장 시각:

- `gas_01`: 연녹색/청록색 material, 약간 투명 또는 emissive
- `ore_01`: 광물 느낌의 회색/보라색 material
- `water_01`: 푸른색/밝은 material

각 인스턴스:

- 모델 clone 사용
- `userData.kind = "resource"`
- 천천히 자전 애니메이션 가능

애니메이션은 부담이 적으므로 허용한다. 다만 게임 데이터에는 영향을 주지 않는다.

### 7.4 Building Model Rendering

`hq_01` 모델을 두 건물 키에 모두 사용한다.

구분 방식:

- `hq1`: 기본 material
- `hq2`: 디버깅 구분용으로 약한 tint 또는 scale 차이

이 구분은 게임 내 의미가 아니라 개발 중 식별 편의를 위한 시각적 힌트다.

각 인스턴스:

- `userData.kind = "building"`
- `userData.building_id = "hq1" | "hq2"`

## 8. UI Plan

### 8.1 Settings Popup Restructure

현재 설정 팝업 내부를 다음 구조로 바꾼다.

```html
<div class="settings-menu">
  <button data-settings-tab="keys">Key Binding</button>
  <button data-settings-tab="data">Data</button>
</div>

<div class="settings-content">
  <section id="settingsKeysPanel"></section>
  <section id="settingsDataPanel"></section>
</div>
```

기존 `keyBindingList`는 `settingsKeysPanel` 내부로 이동한다.

### 8.2 Data Management Panel

표시 항목:

- World seed
- Generated at
- Sector count
- Resource count
- Building count
- Current sector near ship

액션:

- `Regenerate World`
- `Clear World Data`
- `Reload From DB`

권장 UX:

- `Regenerate World`: DB를 지우고 새 월드 생성 후 3D 씬 즉시 갱신
- `Clear World Data`: DB만 비우고 빈 월드 표시
- `Reload From DB`: 현재 DB 스냅샷을 다시 읽고 씬 갱신

위험 액션은 한 번의 confirm이 필요하다.

### 8.3 GameManager Integration

`GameManager`가 `UIManager`에 다음 콜백을 넘긴다.

```js
onRegenerateWorld: () => this.regenerateWorld()
onClearWorldData: () => this.clearWorldData()
onReloadWorldData: () => this.reloadWorldData()
```

`UIManager`는 데이터 요약을 표시하기 위한 메서드를 가진다.

```js
setWorldSummary(summary)
```

## 9. GameManager Integration Plan

### 9.1 Constructor

추가 필드:

```js
this.worldDataManager = new WorldDataManager();
this.worldMapManager = new WorldMapManager({
  scene: this.scene,
  renderScale: WORLD_RENDER_SCALE
});
```

단, `scene`은 `setupScene()` 이후 생기므로 생성 시점은 `setupScene()` 뒤가 더 안전하다.

권장 순서:

```js
setupRenderer()
setupScene()
setupWorld()
setupWorldSystems()
setupTargetMarker()
setupEvents()
```

### 9.2 Loading Sequence

현재 `loadResources()`는 함선 모델과 오디오만 로드한다.

변경 후:

1. 함선 모델 로드
2. 월드 모델 로드
3. 월드 DB 초기화/로드
4. 월드 씬 렌더링
5. 오디오 로드

모든 작업은 `Promise.allSettled`로 묶되, 월드 데이터 생성 실패는 경고로 표시한다.

### 9.3 Update Loop

이번 단계에서 월드 데이터는 움직이지 않는다.

추가 업데이트:

```js
this.worldMapManager.update(dt)
```

사용 목적:

- 자원 모델의 느린 회전
- 선택/하이라이트 애니메이션을 위한 미래 확장

### 9.4 HUD Sector Display

현재 HUD는 X/Y/Z 좌표만 보여준다.

이번 계획에서는 UI 복잡도를 줄이기 위해 즉시 HUD에 섹터명을 넣지 않는다.

다만 `UIManager.setWorldSummary()`의 `currentSector`에는 현재 함선 위치 기준 섹터를 넣는다.

추후 HUD 확장 시:

```js
sector: currentSector?.name || "UNKNOWN"
```

## 10. Implementation Steps

### Step 1. Definitions

작업 파일:

- `js/worldDefinitions.js`
- `js/config.js`

작업 내용:

- 월드 에셋 경로 추가
- 섹터/자원/건물 정의 추가
- 청크 크기와 청크 좌표 계산 규칙 추가
- 초기 배치 수량 정의
- 렌더 스케일 정의

검증:

- 브라우저에서 import error가 없어야 한다.
- `ASSETS.worldModels` URL이 올바르게 생성되어야 한다.

### Step 2. ResourceManager Generic OBJ Loader

작업 파일:

- `js/ResourceManager.js`

작업 내용:

- `loadObjModel(id, source, options)` 추가
- world model normalize 함수 추가
- loadedResources 캐시 활용
- 같은 모델은 한 번만 fetch/parse

검증:

- `gas_01`, `ore_01`, `water_01`, `hq_01` 모두 로드 성공
- 로딩 UI에 각 모델 진행 상태 표시

### Step 3. WorldDataManager

작업 파일:

- `js/WorldDataManager.js`

작업 내용:

- IndexedDB wrapper 구현
- stores 생성
- `chunks` store와 `chunk_id` 기반 인덱스 생성
- `loadOrCreateWorld()`
- `createNewWorld()`
- `clearWorld()`
- `getSummary()`
- `getSectorAtPosition()`
- `getChunkAtPosition()`
- `getChunkIdAtPosition()`

검증:

- 첫 실행 시 섹터 4개, 청크 메타, 자원 6개, 건물 2개 생성
- 모든 자원/건물에 `chunk_id`와 `local_position`이 저장됨
- 새로고침 후 동일 데이터가 DB에서 로드
- Regenerate 시 데이터가 바뀜

### Step 4. WorldMapManager

작업 파일:

- `js/WorldMapManager.js`

작업 내용:

- sector bounds 렌더링
- 필요 시 청크 경계 디버그 렌더링을 켜고 끌 수 있는 내부 옵션 준비
- 자원 모델 배치
- 건물 모델 배치
- clone material 적용
- clear/dispose 구현

검증:

- 섹터 경계가 보임
- `gas1`, `gas2`, `ore1`, `ore2`, `water1`, `water2`가 각각 1개씩 보임
- hq 모델 기반 건물 `hq1`, `hq2`가 각각 1개씩 보임
- 동일 모델을 쓰는 샘플 키가 데이터적으로 구분됨

### Step 5. GameManager Integration

작업 파일:

- `js/GameManager.js`

작업 내용:

- world managers 생성
- loadResources 시 월드 모델과 DB 로드
- renderWorld 호출
- regenerate/clear/reload 메서드 추가
- UI summary 갱신
- update loop에서 월드 애니메이션 호출

검증:

- 기존 함선 조작이 깨지지 않음
- 기존 시작 화면 로딩 흐름 유지
- 월드 데이터 실패 시 게임 전체가 죽지 않고 에러 토스트 표시

### Step 6. Settings UI Data Management

작업 파일:

- `index.html`
- `js/UIManager.js`

작업 내용:

- 설정 팝업 내부 탭/메뉴 추가
- 기존 키 바인딩 UI를 Key Binding 탭에 유지
- Data Management 탭 추가
- summary 렌더링
- regenerate/clear/reload 버튼 이벤트 연결

검증:

- 설정 버튼 클릭 시 메뉴가 보임
- Key Binding 탭에서 기존 키 바인딩 변경 가능
- Data 탭에서 데이터 요약 확인 가능
- Regenerate 후 화면의 오브젝트 위치가 바뀜

### Step 7. Visual Verification

작업 내용:

- 로컬 dev server 실행
- 데스크톱 화면에서 3D 오브젝트 확인
- 모바일 비율에서 설정 팝업 레이아웃 확인
- 콘솔 에러 확인

검증 기준:

- 캔버스가 blank가 아님
- 함선, 섹터 경계, 자원, 건물이 모두 보임
- 모델들이 너무 작거나 거대하지 않음
- 설정 팝업 텍스트가 겹치지 않음
- 버튼 텍스트가 컨테이너 밖으로 넘치지 않음

## 11. Risks and Decisions

### 11.1 Coordinate Scale Risk

샘플의 데이터 좌표와 현재 3D 비행 좌표의 스케일 차이가 크다.

결정:

- 데이터 좌표는 샘플의 큰 좌표계를 유지하되, 3축 글로벌 좌표로 확장한다.
- 모든 좌표는 글로벌 좌표와 청크 파생 좌표를 함께 가진다.
- 렌더링에는 `WORLD_RENDER_SCALE`을 적용한다.
- 섹터 판정은 필요할 때 렌더 좌표 `{ x, y, z }`를 데이터 좌표 `{ x, y, z }`로 변환한다.
- 청크 판정도 같은 변환 뒤 `chunk_id`를 계산한다.

### 11.2 MTL Material Risk

`.mtl` 파일을 쓰면 원본 색상 재현은 좋아질 수 있지만 로딩 경로와 텍스처 의존성이 늘어난다.

결정:

- 이번 단계는 OBJ만 로드한다.
- material은 코드에서 샘플 키별로 부여한다.

### 11.3 IndexedDB Versioning Risk

나중에 저장소 구조가 바뀌면 DB version migration이 필요하다.

결정:

- 이번에는 새 DB 이름 `void-zero-world`를 사용해 기존 키 바인딩 localStorage와 분리한다.
- `dbVersion = 1`로 시작한다.
- meta에 world schema version을 따로 저장한다.

### 11.4 UI Scope Risk

설정 팝업에 너무 많은 관리 기능을 넣으면 시작 화면이 무거워진다.

결정:

- 이번에는 요약과 3개 버튼만 넣는다.
- 상세 테이블은 추후 Scanner/Debug 패널로 분리한다.

## 12. Acceptance Criteria

작업 완료 기준:

- 첫 실행 시 3D 우주 맵에 섹터 경계가 생성된다.
- 자원 키 `gas1`, `gas2`, `ore1`, `ore2`, `water1`, `water2`가 각각 1개씩 배치된다.
- `gas1`, `gas2`는 `gas_01`, `ore1`, `ore2`는 `ore_01`, `water1`, `water2`는 `water_01` 모델을 사용한다.
- 건물 키 `hq1`, `hq2`가 각각 1개씩 배치된다.
- 건물 두 키는 모두 `hq_01` 모델을 사용하되 데이터적으로 구분된다.
- 자원/건물 키는 현재 코드에서 표시 이름이나 세계관상 의미를 갖지 않는다.
- 모든 배치 오브젝트는 `sector_id`, `chunk_id`, 글로벌 3D 좌표 `{ x, y, z }`, 청크 내부 좌표 `local_position`을 가진다.
- 자원과 건물은 `z = 0` 같은 단일 평면에 고정되지 않고, 섹터 부피 안에서 3축으로 분산된다.
- 함선 위치의 글로벌 3D 좌표로 현재 섹터를 판정할 수 있다.
- 함선 위치의 글로벌 3D 좌표로 현재 청크를 계산할 수 있다.
- 설정 팝업 내부에 Key Binding과 Data Management가 병렬 메뉴로 존재한다.
- Data Management에서 월드 요약을 볼 수 있다.
- Data Management에서 월드를 재생성할 수 있다.
- 새로고침 후 IndexedDB에 저장된 월드가 다시 로드된다.
- 이번 작업에 함선 항해 확장이나 주기적 재생성 로직이 포함되지 않는다.

## 13. Future Work

이번 작업 이후 확장 후보:

- 자원/건물 클릭 선택과 정보 패널
- 섹터명 HUD 표시
- 섹터별 환경/조명/배경 효과
- 자원 채굴 액션
- 건물 생산/저장고
- 주기적 자원 재생성
- 항해 큐와 스케줄
- NPC/세력/거래 시스템
- 샘플의 resource allocation 규칙을 완전 이식

## 14. 좌표계와 청크 렌더링 정책

절대좌표와 청크 중심 상대좌표계를 모두 사용한다. 단, 실제 월드 데이터의 원본 값은 항상 절대좌표를 기준으로 엄격하게 관리한다.

- 리소스, 건물, 플레이어 함선 등 게임 데이터의 기준 좌표는 `position: { x, y, z }` 절대좌표다.
- 청크는 데이터의 소유 단위가 아니라 메모리 관리와 렌더링 범위를 제한하기 위한 런타임 단위다.
- 고정 오브젝트는 게임 시작 또는 월드 로드 시 절대좌표를 기준으로 청크 중심 상대좌표를 계산하고 캐시에 저장한다.
- 이 상대좌표 캐시는 런타임 최적화용이며, 저장 데이터의 원본으로 사용하지 않는다.
- 월드 로드 시 상대좌표 캐시는 먼저 초기화한 뒤 현재 월드 스냅샷으로 재생성한다.
- 플레이어 위치의 절대좌표로 현재 청크를 계산하고, 설정된 반경 밖의 청크와 그 내부 오브젝트는 렌더링하지 않는다.
- 생성된 청크 범위 밖의 공간은 빈 공간으로 간주한다.

### 14.1 BGM 전환 정책

플레이어의 절대좌표 위치를 기준으로 현재 공간 상태를 판단하고 BGM을 전환한다.

- 플레이어가 섹터 청크 내부에 있으면 해당 섹터 데이터의 `theme_music_id`를 재생한다.
- 현재 모든 섹터의 기본 `theme_music_id`는 `bgm_sector_01`이다.
- 플레이어가 생성된 청크 안에 있지만 섹터가 아닌 곳에 있으면 `bgm_main_01`을 재생한다.
- 플레이어가 생성된 청크 범위 밖의 빈 공간에 있으면 `bgm_danger_01`을 재생한다.
