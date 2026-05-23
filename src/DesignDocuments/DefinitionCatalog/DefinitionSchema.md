# Definition Schema

***본 문서는 `DesignDocuments/03_DefinitionCatalogPlan.md`의 세부 문서이다. 코드 작업 전 자원, 아이템, 건물, 섹터 정의의 공통 스키마를 합의하기 위한 문서이다.***

## 1. 공통 원칙

- 정의 데이터는 게임 규칙의 원본이다.
- 인스턴스 데이터는 월드 생성 후 IndexedDB에 저장되는 실제 상태이다.
- 현재 테스트 빌드는 기존 캐시/DB 호환을 하지 않는다.
- 새 정의 체계 적용 시 기존 IndexedDB, localStorage, sessionStorage, CacheStorage는 초기화한다.
- migration, legacy alias, 구형/신형 ID 병행 처리는 만들지 않는다.
- 샘플 코드의 섹터 수, 자원 종류, 아이템 종류, 건물 종류, 자원/섹터 수치를 초기 데이터 원본으로 사용한다.
- 3D 모델 경로는 임시 매핑으로 둔다. 추후 `visual.model_id` 또는 모델 경로를 수동 교체할 수 있어야 한다.

## 2. ID 규칙

| 대상 | 형식 | 예시 | 설명 |
|---|---|---|---|
| Item Definition | `item_###` | `item_001` | 화물, 거래, 생산 단위 |
| Resource Definition | `rss_###` | `rss_001` | 월드에 생성되는 자원 노드 타입 |
| Building Definition | snake_case | `arc_station` | 건물/시설 타입 |
| Sector Definition | `SEC-###` | `SEC-001` | 섹터 타입 및 운영 데이터 |
| Resource Instance | `RES-{RESOURCE_ID}-{seed/index}` | `RES-RSS_001-...` | 실제 생성된 자원 노드 |
| Building Instance | `BLD-{BUILDING_ID}-{seed/index}` | `BLD-mine-...` | 실제 생성된 건물 |

구형 ID인 `gas1`, `gas2`, `ore1`, `ore2`, `water1`, `water2`, `hq1`, `hq2`는 신규 정의 체계에서 사용하지 않는다.

## 3. Item Definition

아이템은 채집, 화물, 저장, 거래, 생산에서 사용하는 물품 단위이다.

```js
{
  item_id: "item_001",
  label_key: "item.item_001.name",
  description_key: "item.item_001.description",
  category: "resource",
  type: "hydrite_mineral",
  mass: 1.0,
  tradable: true,
  stackable: true
}
```

필수 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| `item_id` | string | 아이템 고유 ID |
| `label_key` | string | 표시명 i18n key |
| `description_key` | string | 설명 i18n key |
| `category` | string | 상위 분류 |
| `type` | string | 세부 분류 |
| `mass` | number | 화물 용량 계산용 질량 |
| `tradable` | boolean | 거래 가능 여부 |
| `stackable` | boolean | 중첩 가능 여부 |

샘플 코드의 `isTradable`은 코드 단계에서 `tradable`로 정규화한다.

## 4. Resource Definition

자원 정의는 월드에 생성되는 자원 노드의 규칙이다.

```js
{
  resource_id: "rss_001",
  produces_item_id: "item_001",
  node_type: "PERMANENT",
  total_capacity: 1000000,
  spawn_limit_per_cycle: 200000,
  node_capacity_range: [10000, 20000],
  sector_ratio: 0.3,
  base_yield_per_sec: 5.0,
  lifetime_range: null,
  visual: {
    model_id: "ore_01",
    category: "hydrite_mineral",
    color: 0x00c7ff,
    scale: 16
  }
}
```

필수 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| `resource_id` | string | `rss_###` 자원 타입 ID |
| `produces_item_id` | string | 생산 아이템 ID |
| `node_type` | string | `PERMANENT` 또는 `DECAYING` |
| `total_capacity` | number | 전역 목표 총량 |
| `spawn_limit_per_cycle` | number | 한 주기 최대 생성량 |
| `node_capacity_range` | number[] | 개별 노드 용량 범위 |
| `sector_ratio` | number | 섹터 내부 배치 비율 |
| `base_yield_per_sec` | number | 기본 채집 속도 |
| `visual` | object | 3D 렌더링 힌트 |

선택 필드:

| 필드 | 타입 | 설명 |
|---|---|---|
| `lifetime_range` | number[] | `DECAYING` 자원 수명 범위 |

## 5. Building Definition

건물 정의는 월드에 배치 가능한 시설의 규칙이다.

```js
{
  building_id: "mine",
  label_key: "building.mine.name",
  description_key: "building.mine.description",
  size: "중형",
  category: "자원 생산 시설",
  hp: 1000,
  admin_cost: 0,
  placement_rule: {
    type: "resource_node",
    required_resource_type: "mineral"
  },
  production_profile: {
    kind: "RESOURCE_EXTRACTOR",
    source: {
      type: "attached_resource_node",
      depletes: true,
      lock_expiry: true
    },
    outputs: [
      {
        output_type: "item",
        item_id: "$source.produces_item_id",
        amount_per_sec: "$source.base_yield_per_sec"
      }
    ],
    output_sink: "building_inventory"
  },
  storage: {
    capacity: 0
  },
  docking: {
    capacity: 0
  },
  trade: {
    enabled: false
  },
  visual: {
    model_id: "hq_01",
    scale: 5
  }
}
```

샘플 코드의 `build_range`는 코드 단계에서 `placement_rule`로 정규화한다.

기존 샘플의 `base_production`, `production` boolean 필드는 신규 정의 체계에서 사용하지 않는다. 생산 규칙은 `production_profile`을 유일한 원본으로 삼는다. `recipe_id`는 `FACTORY` 프로필에만 사용하며, recipe catalog의 내부 구조는 별도 단계에서 정의한다.

| 샘플 `build_range.type` | 3D `placement_rule.type` | 설명 |
|---|---|---|
| `sector_center` | `sector_anchor` | 섹터 기준점 주변 배치 |
| `resource_node` | `resource_node` | 특정 자원 노드 기반 배치 |
| `anywhere` | `free_space` | 섹터/청크 내부 빈 공간 배치 |

## 6. Sector Definition

섹터 정의는 섹터의 운영 데이터와 자원/건물 배치 정책, 배경음 정보를 가진다.

```js
{
  sector_id: "SEC-001",
  name: "EPSILON PRIME",
  theme: "Volcanic_Industrial",
  theme_music_id: "bgm_sector_01",
  stats: {
    base_gdp_coeff: 1.2,
    admin_capacity: 500,
    population_cap: 1000000,
    environmental_weight: {
      mining_efficiency: 1.5,
      agriculture_efficiency: 0.5
    }
  },
  resource_weights: {
    rss_001: 5,
    rss_002: 15
  },
  initial_buildings: [
    { building_id: "arc_station", count: 1 }
  ],
  initial_resource_facilities: [
    { building_id: "mine", count: 4 }
  ]
}
```

`theme_music_id`는 샘플 코드에는 없지만 현재 3D 프로젝트에서는 필수 필드이다.

샘플 코드의 `grid_size`, 2D `global_bounds`, `SECTOR_SIZE`는 섹터 정의에 포함하지 않는다. 공간 구조는 현재 프로젝트의 전역 월드 설정을 따른다.

공간 규격의 기준:

- `WORLD_CONFIG.sectorSize`
- `WORLD_CONFIG.chunkSize`
- `WORLD_CONFIG.chunkGrid`
- `WORLD_CONFIG.renderChunkRadius`

섹터 정의는 운영/생성 규칙을 담고, 실제 섹터 크기와 청크 배정은 월드 생성 시 `WORLD_CONFIG`를 기준으로 만든 섹터 인스턴스가 가진다.

## 7. Instance Schema

### 7.1 Resource Instance

```js
{
  resource_instance_id: "RES-RSS_001-...",
  resource_id: "rss_001",
  produces_item_id: "item_001",
  category: "hydrite_mineral",
  sector_id: "SEC-001",
  chunk_id: "0:0:0",
  chunk: { x: 0, y: 0, z: 0 },
  position: { x: 0, y: 0, z: 0 },
  local_position: { x: 0, y: 0, z: 0 },
  total_capacity: 10000,
  current_amount: 10000,
  base_yield_per_sec: 5,
  spawn_time: 0,
  expiry_time: null
}
```

### 7.2 Building Instance

```js
{
  building_instance_id: "BLD-mine-...",
  building_id: "mine",
  sector_id: "SEC-001",
  chunk_id: "0:0:0",
  chunk: { x: 0, y: 0, z: 0 },
  position: { x: 0, y: 0, z: 0 },
  local_position: { x: 0, y: 0, z: 0 },
  hp: 1000,
  status: "active",
  created_at: 0
}
```

### 7.3 Sector Instance

```js
{
  sector_id: "SEC-001",
  chunk_id: "0:0:0",
  chunk: { x: 0, y: 0, z: 0 },
  global_bounds: {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 400000, y: 400000, z: 400000 }
  },
  created_at: 0
}
```

섹터 인스턴스는 정의 데이터 전체를 복사하지 않는다. 표시명, BGM, 자원 가중치 등은 `sector_id`로 정의 카탈로그를 참조한다.
