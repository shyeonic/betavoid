# Production Profile Plan

본 문서는 건물 생산 데이터 구조를 정의하기 위한 개발 계획서다. 목표는 자원 생명주기와 충돌하지 않는 방식으로 자가생산, 자원생산, 상품생산을 같은 카탈로그 체계 안에 배치하는 것이다.

## 1. 목표

- 기존 `base_production`, `production` boolean 구조를 대체할 수 있는 명시적 생산 프로필을 도입한다.
- 자원지 위에 건설되는 건물은 자원 총량을 늘리지 않고 원본 자원지를 고정하고 채집하는 역할만 갖게 한다.
- `recipe_id`는 상품생산건물(`FACTORY`)에만 사용한다.
- recipe catalog의 내부 구조는 이번 단계에서 설계하지 않는다.
- 생산 tick, 창고, 물류, 전력 소비, 노동자 배치 구현은 이후 단계로 둔다.

## 2. 생산 카테고리

### 2.1 `SELF`

자가생산건물이다. 외부 입력 아이템이나 자연 자원지를 소비하지 않고 자체 효과 또는 산출물을 만든다.

규칙:

- `recipe_id`를 갖지 않는다.
- `outputs`를 가진다.
- 출력은 현재 아이템 카탈로그에 없는 값도 표현할 수 있도록 `output_type`으로 구분한다.

예시:

```js
production_profile: {
  kind: "SELF",
  outputs: [
    { output_type: "service", service_id: "power" }
  ],
  output_sink: "building_inventory"
}
```

### 2.2 `RESOURCE_EXTRACTOR`

자원생산건물이다. 우주에 존재하는 자원 노드 위에 건설되어 원본 자원 노드의 매장량을 고정하고, 그 매장량을 감소시키며 1차 자원 아이템을 생산한다.

규칙:

- `recipe_id`를 갖지 않는다.
- `placement_rule.type`은 반드시 `resource_node`여야 한다.
- 원본 resource node의 `current_amount`, `total_capacity`, `base_yield_per_sec`, `produces_item_id`를 건물 인스턴스가 승계한다.
- 생산량은 원본 자원 상태에서 해석한다.
- 원본 자원 노드는 `resourceNodes` store에서 제거되지만, 그 잔량은 건물 인스턴스의 `current_amount`에 남는다.
- 건물은 글로벌 자원 총량을 독립적으로 증가시키지 않는다.

예시:

```js
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
}
```

### 2.3 `FACTORY`

상품생산건물이다. 자연 자원지가 아니라 창고, 물류, 재료 아이템을 소비하여 다른 아이템 또는 상품을 생산한다.

규칙:

- `recipe_id`를 반드시 가진다.
- `recipe_id`의 실제 참조 검증은 recipe catalog 도입 후 추가한다.
- 이번 단계에서는 recipe 내부의 `inputs`, `outputs`, `duration` 구조를 정의하지 않는다.
- `outputs`를 건물 정의에 중복 기록하지 않는다.

예시:

```js
production_profile: {
  kind: "FACTORY",
  recipe_id: "weapon_factory.standard_weapon",
  output_sink: "building_inventory"
}
```

## 3. 건물 정의 스키마

```js
{
  building_id: "mine",
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
  }
}
```

생산하지 않는 건물은 `production_profile`을 갖지 않는다.

## 4. 건물 인스턴스 스키마

자원생산건물은 원본 자원 노드 상태를 승계한다.

```js
{
  building_instance_id: "BLD-mine-...",
  building_id: "mine",
  source_resource_instance_id: "RES-RSS_003-...",
  resource_id: "rss_003",
  produces_item_id: "item_003",
  total_capacity: 6000,
  current_amount: 6000,
  base_yield_per_sec: 6,
  production_state: {
    active: true,
    last_tick_at: 1710000000000,
    accumulated_ms: 0,
    paused_reason: null
  },
  inventory: {}
}
```

이번 단계에서는 `production_state`와 `inventory`의 런타임 갱신을 구현하지 않는다. 단, 구조를 확장할 수 있도록 생산 프로필 정의를 먼저 고정한다.

## 5. 검증 규칙

`validateDefinitionCatalog()`는 다음을 검사한다.

- `SELF`
  - `recipe_id`가 있으면 오류
  - `outputs`가 비어 있으면 오류
- `RESOURCE_EXTRACTOR`
  - `recipe_id`가 있으면 오류
  - `placement_rule.type !== "resource_node"`이면 오류
  - `source.type !== "attached_resource_node"`이면 오류
- `FACTORY`
  - `recipe_id`가 없으면 오류
  - recipe 존재 여부는 아직 검사하지 않음
- 모든 생산 프로필
  - `kind`는 `SELF`, `RESOURCE_EXTRACTOR`, `FACTORY` 중 하나여야 함
  - `output_sink`는 명시되어야 함

## 6. 이번 단계 작업

1. 본 계획 문서를 추가한다.
2. `buildingDefinitions.js`에 `production_profile` helper와 건물별 프로필을 추가한다.
3. 기존 `base_production`, `production`은 제거하고 `production_profile`을 유일한 생산 정의 원본으로 둔다.
4. `definitionIndexes.js`에 생산 프로필 검증을 추가한다.
5. 정의 카탈로그 검증과 기존 i18n 검증을 통과시킨다.

## 7. 이후 단계

- recipe catalog 설계
- 생산 tick 설계
- 건물 inventory와 저장소/물류 연결
- 생산 중단 사유와 UI 표시
- recipe catalog 설계 전까지 `FACTORY.recipe_id`는 문자열 식별자로만 유지
