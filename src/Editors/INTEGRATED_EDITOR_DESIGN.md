# Void Zero — 통합 에디터 데이터 설계

*2026-06-05*

---

## 대원칙

에디터의 출력은 **하나의 완결된 게임 세계 정의(캡슐)**다.
캡슐 하나 = 하나의 독립적 게임 세계. 배포 후 불변.
**Definition**(에디터 출력) vs **State**(런타임 관리)는 철저히 분리된다.

---

## 캡슐 파일 구조

```
capsule/
  manifest.json          세계 식별자, 캡슐 버전
  world_config.json      청크/배치/생성 파라미터
  asset_registry.json    에셋 ID → 파일 경로 매핑 (모델, BGM)
  item_defs.json         아이템 정의 (자원 상품)
  resource_defs.json     자원 노드 정의 (채굴 대상)
  building_defs.json     건물 정의
  sector_defs.json       섹터 정의
  ship_defs.json         함선 정의
  i18n.json              다국어 문자열 — system(고정) + content(편집 가능)
  chunk_map.gmapdata     청크 어노테이션
  [world].gmap           유효 청크 비트마스크 (참조, 불변)
```

---

## 1. manifest.json

```json
{
  "capsule_id":      "void-zero-default",
  "capsule_version": "1.0.0",
  "name":            "Void Zero — Default Galaxy",
  "created_at":      "2026-06-05T00:00:00Z",
  "gmap_file":       "galaxyMapData.gmap",
  "active_cluster":  0
}
```

---

## 2. asset_registry.json

캡슐 내 모든 에셋 ID가 실제 어떤 파일을 참조하는지 선언한다.
게임이 "ID만 알고 파일 경로를 모르는" 상태를 없애기 위한 파일.

에디터가 자동으로 수집하는 참조 ID 목록:
- `ship_defs.json`의 `visual.modelId`
- `resource_defs.json`의 `visual.modelId`
- `building_defs.json`의 `visual.modelId`
- `sector_defs.json`의 `themeMusicId`

```json
{
  "version": 1,
  "models": {
    "ship_01":  "assets/models/ships/ship_01.glb",
    "ship_02":  "assets/models/ships/ship_02.glb",
    "water_01": "assets/models/resources/water_01.glb",
    "ore_01":   "assets/models/resources/ore_01.glb",
    "gas_01":   "assets/models/resources/gas_01.glb",
    "hq_01":    "assets/models/buildings/hq_01.glb",
    "mine_01":  "assets/models/buildings/mine_01.glb",
    "power_01": "assets/models/buildings/power_01.glb"
  },
  "audio": {
    "bgm_sector_01": "assets/audio/bgm_sector_01.ogg",
    "bgm_sector_02": "assets/audio/bgm_sector_02.ogg"
  }
}
```

**에디터 동작:**
- 캡슐 내 정의들을 스캔하여 참조되는 ID 목록을 자동으로 추출
- 각 ID에 대해 파일 경로를 입력할 수 있는 간단한 폼 제공
- 경로 미입력 ID는 WARNING으로 표시
- 파일 경로는 에디터가 검증하지 않음 (런타임의 책임)

---

## 3. world_config.json

현재 `WORLD_CONFIG`에 대응.

```json
{
  "version": 1,
  "chunkSize":               { "x": 400000, "y": 400000, "z": 400000 },
  "resourceCheckInterval":   86400000,
  "placementMargin":         800,
  "resourceMinDistance":     1200,
  "buildingMinDistance":     1600,
  "betaVoidMinDistance":     200,
  "betaVoidTargetsPerSector": 5
}
```

---

## 3. item_defs.json

현재 `ITEM_DEFINITIONS` (10개)에 대응.
아이템은 자원 노드가 생산하는 상품이며, 거래·인벤토리 시스템의 기본 단위.

**에디터 편집 범위**: category, type, mass. (tradable/stackable은 현재 모두 true 고정)

```json
{
  "version": 1,
  "items": {
    "item_001": {
      "id":       "item_001",
      "category": "resource",
      "type":     "hydrite_mineral",
      "mass":     1.0,
      "tradable": true,
      "stackable":true
    },
    "item_002": { "id":"item_002", "category":"resource", "type":"mineral",          "mass":1.5, "tradable":true, "stackable":true },
    "item_003": { "id":"item_003", "category":"resource", "type":"mineral",          "mass":1.2, "tradable":true, "stackable":true },
    "item_004": { "id":"item_004", "category":"resource", "type":"mineral",          "mass":1.0, "tradable":true, "stackable":true },
    "item_005": { "id":"item_005", "category":"resource", "type":"mineral",          "mass":2.0, "tradable":true, "stackable":true },
    "item_006": { "id":"item_006", "category":"resource", "type":"mineral",          "mass":0.8, "tradable":true, "stackable":true },
    "item_007": { "id":"item_007", "category":"resource", "type":"gas",             "mass":0.2, "tradable":true, "stackable":true },
    "item_008": { "id":"item_008", "category":"resource", "type":"gas",             "mass":0.3, "tradable":true, "stackable":true },
    "item_009": { "id":"item_009", "category":"resource", "type":"gas",             "mass":0.5, "tradable":true, "stackable":true },
    "item_010": { "id":"item_010", "category":"resource", "type":"gas",             "mass":0.4, "tradable":true, "stackable":true }
  }
}
```

**type 허용값**: `hydrite_mineral` | `mineral` | `gas`

---

## 4. resource_defs.json

현재 `RESOURCE_DEFINITIONS` (10개)에 대응.
자원 노드 = 우주 공간에 스폰되는 채굴 가능한 오브젝트.

**에디터 편집 범위**: 전체 (nodeType, 용량, 스폰 파라미터, 시각화).

```json
{
  "version": 1,
  "resources": {
    "rss_001": {
      "id":                "rss_001",
      "producesItemId":    "item_001",
      "nodeType":          "PERMANENT",
      "totalCapacity":     1000000,
      "spawnLimitPerCycle":200000,
      "nodeCapacityRange": [10000, 20000],
      "sectorRatio":       0.3,
      "baseYieldPerSec":   5.0,
      "visual": { "category": "hydrite_mineral", "modelId": "water_01" }
    },
    "rss_007": {
      "id":                "rss_007",
      "producesItemId":    "item_007",
      "nodeType":          "DECAYING",
      "totalCapacity":     800000,
      "spawnLimitPerCycle":40000,
      "nodeCapacityRange": [3000, 6000],
      "sectorRatio":       0.4,
      "baseYieldPerSec":   8.0,
      "lifetimeRange":     [432000000, 864000000],
      "visual": { "category": "gas", "modelId": "gas_01" }
    }
  }
}
```

**nodeType**: `PERMANENT` | `DECAYING`  
**DECAYING**일 때만 `lifetimeRange` 존재.  
**visual.category 허용값**: `hydrite_mineral` | `mineral` | `gas`

---

## 5. building_defs.json

현재 `BUILDING_DEFINITIONS` (22개)에 대응.

건물 정의는 복잡하다. 에디터는 핵심 필드를 직접 편집하고,
`production_profile` 같은 복잡한 로직 구조는 **단순화된 형태로 표현**한다.
게임 런타임은 이 단순화된 형태를 원래 구조로 변환하는 책임을 가진다.

**에디터 편집 범위**:
- 완전 편집: identity, size, category, hp, admin_cost, placement, docking, visual
- 단순화 편집: production_profile (kind + 핵심 파라미터)
- 편집 불가 (코드 고정): 복잡한 factory recipe 그래프, polity_resource 세부 로직

```json
{
  "version": 1,
  "buildings": {

    "arc_station": {
      "id":          "arc_station",
      "size":        "EX",
      "category":    "headquarters",
      "hp":          10000,
      "adminCost":   50,
      "placement": { "type": "sector_anchor", "radius": null },
      "production": {
        "kind":    "SELF",
        "outputs": [
          { "type": "service", "serviceId": "docking" },
          { "type": "service", "serviceId": "population" },
          { "type": "service", "serviceId": "power" }
        ],
        "outputSink": "public"
      },
      "docking": { "capacity": 12 },
      "trade": { "enabled": true, "handling_speed": 1.0, "cargo_capacity": 5000, "min_reputation": 0 },
      "initialInventory": { "item_001": 5000, "item_004": 3000 },
      "visual": { "modelId": "hq_01", "color": "#ffffff", "emissive": "#17345e", "emissiveIntensity": 0.08, "scale": 5 }
    },

    "mine": {
      "id":          "mine",
      "size":        "L",
      "category":    "resource_production",
      "hp":          3000,
      "adminCost":   8,
      "placement": { "type": "resource_node", "requiredResourceType": "mineral" },
      "production": {
        "kind":         "RESOURCE_EXTRACTOR",
        "depletes":     true,
        "lockExpiry":   true,
        "outputSink":   "building_inventory"
      },
      "docking":  { "capacity": 2 },
      "trade":    { "enabled": false },
      "visual":   { "modelId": "mine_01", "color": "#ffffff", "emissive": "#17345e", "emissiveIntensity": 0.08, "scale": 5 }
    },

    "plasma_power_plant": {
      "id":          "plasma_power_plant",
      "size":        "L",
      "category":    "power_plant",
      "hp":          4000,
      "adminCost":   15,
      "placement": { "type": "free_space" },
      "production": {
        "kind":    "SELF",
        "outputs": [{ "type": "service", "serviceId": "power" }],
        "outputSink": "public"
      },
      "docking":  { "capacity": 0 },
      "trade":    { "enabled": false },
      "visual":   { "modelId": "power_01", "color": "#ffffff", "emissive": "#17345e", "emissiveIntensity": 0.08, "scale": 5 }
    }
  }
}
```

**placement.type 허용값**: `sector_anchor` | `free_space` | `resource_node`  
**production.kind 허용값**: `NONE` | `SELF` | `RESOURCE_EXTRACTOR` | `FACTORY`  
**size 허용값**: `EX` | `L` | `M` | `S`  
**category 허용값**: defense_turret | factory | habitation | headquarters | hyperdrive_energy | outpost | power_plant | resource_production | shipyard | trade_port

---

## 6. sector_defs.json

현재 `SECTOR_DEFINITIONS` (10개)에 대응.

**에디터 편집 범위**: 전체.

```json
{
  "version": 1,
  "sectors": {
    "SEC-001": {
      "id":           "SEC-001",
      "theme":        "Volcanic_Industrial",
      "themeMusicId": "bgm_sector_01",
      "color":        "#ff6b35",
      "stats": {
        "base_gdp_coeff":  1.2,
        "admin_capacity":  500,
        "population_cap":  1000000,
        "environmental_weight": {
          "mining_efficiency":   1.5,
          "agriculture_efficiency": 0.5
        }
      },
      "initialBuildings": [
        { "building_id": "arc_station",         "count": 1 },
        { "building_id": "plasma_power_plant",  "count": 2 },
        { "building_id": "orbital_dorm",        "count": 3 },
        { "building_id": "orbital_defence_turret", "count": 5 }
      ],
      "initialResourceFacilities": [
        { "building_id": "mine",             "count": 4 },
        { "building_id": "refinery",         "count": 2 },
        { "building_id": "hydro_synthesizer","count": 1 }
      ]
    }
  }
}
```

---

## 7. ship_defs.json

현재 `SHIP_DEFINITIONS` + `SHIP_VISUAL_DEFINITIONS`에 대응.

함선 시각 정의(lightParts, objectMatches)는 3D 에셋의 메시 이름에 종속적이다.
에디터는 **색상과 수치만 편집**하고, 전체 lightParts 배열은 코드에 유지한다.

**에디터 편집 범위**:
- 완전 편집: specs, hyperdriveSpecs
- 색상 편집: highlightColor, engineLightColor (런타임이 lightParts에 적용)
- 편집 불가 (코드 고정): lightParts 배열 구조, objectMatches, VFX 세부 설정

```json
{
  "version": 1,
  "ships": {
    "ship_01": {
      "id": "ship_01",
      "specs": {
        "maxSpeed":                100,
        "minSpeed":                -20,
        "accelerationRate":        24,
        "decelerationRate":        32,
        "throttleAdjustRate":      36,
        "arrivalRadius":           10,
        "deactivationCoastDuration": 600,
        "pitchRate":               1.45,
        "yawRate":                 1.55,
        "rollRate":                1.8,
        "strafeRate":              45,
        "verticalRate":            45
      },
      "hyperdriveSpecs": {
        "cooldownDuration":      5,
        "warpEntryDuration":     0.6,
        "warpExitDuration":      0.6,
        "warpMinFlightDuration": 5,
        "warpFlightSpeed":       4000
      },
      "visual": {
        "modelId":             "ship_01",
        "reflectionIntensity": 0.32,
        "highlightColor":      "#ff97c2",
        "engineLightColor":    "#9b9bff"
      }
    },
    "ship_02": {
      "id": "ship_02",
      "specs": { "maxSpeed":100, "minSpeed":-20, "accelerationRate":24, "decelerationRate":32,
                 "throttleAdjustRate":36, "arrivalRadius":10, "deactivationCoastDuration":600,
                 "pitchRate":1.45, "yawRate":1.55, "rollRate":1.8, "strafeRate":45, "verticalRate":45 },
      "hyperdriveSpecs": { "cooldownDuration":5, "warpEntryDuration":0.6, "warpExitDuration":0.6,
                           "warpMinFlightDuration":5, "warpFlightSpeed":4000 },
      "visual": {
        "modelId":             "ship_02",
        "reflectionIntensity": 0.32,
        "highlightColor":      "#286d4d",
        "engineLightColor":    "#9b9bff"
      }
    }
  }
}
```

---

## 9. i18n.json

### 구조 원칙

i18n.json은 두 영역을 명확히 분리한다.

| 영역 | 키 | 편집 방법 | 에디터 역할 |
|------|----|-----------|-----------| 
| **system** | `ui.*`, `scanner.*`, `betaVoid.*`, `buildingSize.*`, `buildingCategory.*` | 코드(locale 파일) 직접 수정 | 기본값을 그대로 출력 (잠금) |
| **content** | `item.*`, `resource.*`, `building.*`, `sector.*`, `ship.*` | 에디터 각 탭에서 편집 | 편집 결과를 출력 |

**system**: 게임 시스템의 고정 문자열. 에디터는 현재 기본값을 읽어 그대로 출력한다.
수정하려면 `locales/ko.js`, `locales/en.js`를 직접 편집해야 한다.

**content**: 각 엔티티(아이템, 자원, 건물, 섹터, 함선)에 속한 이름·설명.
에디터에서 엔티티를 편집할 때 해당 언어 문자열도 함께 편집한다.

```json
{
  "version": 1,
  "system": {
    "ko": {
      "ui": {
        "settings": {
          "title": "설정", "close": "닫기",
          "language": "언어", "languageHint": "변경하면 화면을 다시 불러옵니다",
          "languages": { "en": "영어", "ko": "한국어" },
          "common": { "none": "없음", "off": "끔", "on": "켬" },
          "world": {
            "seed": "시드", "generated": "생성일", "sectors": "섹터", "chunks": "청크",
            "resources": "자원", "buildings": "건물", "currentSector": "현재 섹터",
            "currentChunk": "현재 청크", "regenerate": "재생성", "reloadDb": "DB 다시 읽기",
            "clearAllData": "모든 데이터 삭제",
            "confirmRegenerate": "월드 데이터를 다시 생성할까요?",
            "confirmClear": "저장된 모든 데이터를 삭제할까요?"
          },
          "gameplay": { "shipSelect": "함선", "ship01": "함선 I", "ship02": "함선 II" },
          "controls": { "reset": "초기화" },
          "graphics": {
            "environment": "환경", "light": "라이트", "dark": "다크",
            "chunkBounds": "격자 시각화", "all": "전체", "sector": "섹터",
            "materialTextures": "머티리얼 텍스처", "renderResolution": "렌더 해상도",
            "antialias": "안티앨리어싱", "bloomQuality": "블룸 품질",
            "low": "낮음", "medium": "중간", "high": "높음", "lightingEffects": "광원 효과"
          }
        },
        "player": { "title": "파일럿", "shipSection": "함선" },
        "scanner": {
          "categories": { "buildings": "건물", "resources": "자원", "betaVoids": "베타 보이드" },
          "empty": "감지된 객체 없음", "select": "선택", "detail": "상세",
          "autoNavigate": "자동 항법", "objectDetail": "객체 상세", "closeDetail": "상세 닫기",
          "fields": {
            "amount": "수량", "category": "분류", "chunk": "청크", "chunkRelative": "청크 상대 좌표",
            "distance": "거리", "hp": "HP", "name": "이름", "position": "좌표",
            "sector": "섹터", "status": "상태", "type": "유형"
          }
        }
      },
      "betaVoid": { "name": "베타 보이드", "processed": "베타 보이드 처리 완료", "processFailed": "베타 보이드 처리 실패" },
      "buildingSize":     { "EX": "전용", "L": "대형", "M": "중형", "S": "소형" },
      "buildingCategory": {
        "defense_turret": "방어 포탑", "factory": "공장", "habitation": "거주 시설",
        "headquarters": "헤드쿼터", "hyperdrive_energy": "하이퍼드라이브 에너지 생산 시설",
        "outpost": "전초기지", "power_plant": "발전소", "resource_production": "자원 생산 시설",
        "shipyard": "조선소", "trade_port": "거래소"
      }
    },
    "en": {
      "ui": {
        "settings": {
          "title": "Settings", "close": "Close",
          "language": "Language", "languageHint": "Applies after reload",
          "languages": { "en": "English", "ko": "Korean" },
          "common": { "none": "None", "off": "Off", "on": "On" },
          "world": {
            "seed": "Seed", "generated": "Generated", "sectors": "Sectors", "chunks": "Chunks",
            "resources": "Resources", "buildings": "Buildings", "currentSector": "Current Sector",
            "currentChunk": "Current Chunk", "regenerate": "Regenerate", "reloadDb": "Reload DB",
            "clearAllData": "Clear All Data",
            "confirmRegenerate": "Regenerate world data?",
            "confirmClear": "Clear all stored data?"
          },
          "gameplay": { "shipSelect": "Ship", "ship01": "Ship I", "ship02": "Ship II" },
          "controls": { "reset": "Reset" },
          "graphics": {
            "environment": "Environment", "light": "Light", "dark": "Dark",
            "chunkBounds": "Grid Visualization", "all": "All", "sector": "Sector",
            "materialTextures": "Material Textures", "renderResolution": "Render Resolution",
            "antialias": "Anti-Aliasing", "bloomQuality": "Bloom Quality",
            "low": "Low", "medium": "Medium", "high": "High", "lightingEffects": "Lighting Effects"
          }
        },
        "player": { "title": "Pilot", "shipSection": "Ship" },
        "scanner": {
          "categories": { "buildings": "Buildings", "resources": "Resources", "betaVoids": "Beta Void" },
          "empty": "No objects detected", "select": "Select", "detail": "Detail",
          "autoNavigate": "Auto Navigate", "objectDetail": "Object detail", "closeDetail": "Close detail",
          "fields": {
            "amount": "Amount", "category": "Category", "chunk": "Chunk", "chunkRelative": "Chunk Relative",
            "distance": "Distance", "hp": "HP", "name": "Name", "position": "Position",
            "sector": "Sector", "status": "Status", "type": "Type"
          }
        }
      },
      "betaVoid": { "name": "Beta Void", "processed": "Beta Void processed", "processFailed": "Beta Void process failed" },
      "buildingSize":     { "EX": "Exclusive", "L": "Large", "M": "Medium", "S": "Small" },
      "buildingCategory": {
        "defense_turret": "Defence Turret", "factory": "Factory", "habitation": "Habitation",
        "headquarters": "Headquarters", "hyperdrive_energy": "Hyperdrive Energy Facility",
        "outpost": "Outpost", "power_plant": "Power Plant", "resource_production": "Resource Production",
        "shipyard": "Shipyard", "trade_port": "Trade Port"
      }
    }
  },
  "content": {
    "ko": {
      "item": {
        "item_001": { "name": "하이드라이트",  "description": "수소광물 자원" },
        "item_002": { "name": "티타늄",        "description": "광물 자원" },
        "item_003": { "name": "구리",           "description": "광물 자원" },
        "item_004": { "name": "철",             "description": "광물 자원" },
        "item_005": { "name": "금",             "description": "광물 자원" },
        "item_006": { "name": "실리콘",         "description": "광물 자원" },
        "item_007": { "name": "수소",           "description": "가스 자원" },
        "item_008": { "name": "헬륨",           "description": "가스 자원" },
        "item_009": { "name": "제논",           "description": "가스 자원" },
        "item_010": { "name": "탈리스",         "description": "가스 자원" }
      },
      "resource": {
        "rss_001": { "name": "하이드라이트 매장지", "description": "하이드라이트를 생산하는 자원 노드" },
        "rss_002": { "name": "티타늄 매장지",       "description": "티타늄을 생산하는 자원 노드" },
        "rss_003": { "name": "구리 매장지",          "description": "구리를 생산하는 자원 노드" },
        "rss_004": { "name": "철 매장지",            "description": "철을 생산하는 자원 노드" },
        "rss_005": { "name": "금 매장지",            "description": "금을 생산하는 자원 노드" },
        "rss_006": { "name": "실리콘 매장지",        "description": "실리콘을 생산하는 자원 노드" },
        "rss_007": { "name": "수소 가스전",          "description": "수소를 생산하는 소멸형 가스 노드" },
        "rss_008": { "name": "헬륨 가스전",          "description": "헬륨을 생산하는 소멸형 가스 노드" },
        "rss_009": { "name": "제논 가스전",          "description": "제논을 생산하는 소멸형 가스 노드" },
        "rss_010": { "name": "탈리스 가스전",        "description": "탈리스를 생산하는 소멸형 가스 노드" }
      },
      "building": {
        "arc_station":            { "name": "아크 스테이션",      "description": "..." },
        "plasma_power_plant":     { "name": "플라즈마 파워 플랜트","description": "..." },
        "beta_particle_reactor":  { "name": "베타 입자 리액터",   "description": "..." },
        "orbital_dorm":           { "name": "궤도 거주지",         "description": "..." },
        "colony_dorm":            { "name": "외곽 거주지",         "description": "..." },
        "orbital_defence_turret": { "name": "궤도 방어 터렛",      "description": "..." },
        "sentinel_turret":        { "name": "감시 터렛",           "description": "..." },
        "shipyard":               { "name": "조선소",              "description": "..." },
        "trade_port":             { "name": "무역항",              "description": "..." },
        "outbase":                { "name": "아웃베이스",           "description": "..." },
        "hydro_synthesizer":      { "name": "수자원 합성소",        "description": "..." },
        "mine":                   { "name": "광산",                "description": "..." },
        "refinery":               { "name": "정제소",              "description": "..." },
        "bio_fab":                { "name": "바이오 팹",            "description": "..." },
        "food_factory":           { "name": "식품 공장",           "description": "..." },
        "silicon_factory":        { "name": "반도체 공장",         "description": "..." },
        "weapon_factory":         { "name": "무기 공장",           "description": "..." },
        "advanced_weapon_factory":{ "name": "특수 무기 공장",      "description": "..." }
      },
      "sector": {
        "SEC-001": { "name": "엡실론 프라임",      "theme": "화산 산업지대"  },
        "SEC-002": { "name": "노바 스테이션",       "theme": "무역 허브"      },
        "SEC-003": { "name": "크림슨 익스팬스",     "theme": "사막 황무지"    },
        "SEC-004": { "name": "애저 네뷸라",         "theme": "가스 행성권"    },
        "SEC-005": { "name": "옵시디언 리치",       "theme": "암흑 물질 지대" },
        "SEC-006": { "name": "타이탄 게이트",       "theme": "군사 요새"      },
        "SEC-007": { "name": "헬리오스 코어",       "theme": "태양 제련소"    },
        "SEC-008": { "name": "프로스트 프론티어",   "theme": "얼음 세계"      },
        "SEC-009": { "name": "에메랄드 헤이븐",     "theme": "농업 낙원"      },
        "SEC-010": { "name": "보이드 엣지",         "theme": "개척 전초지"    }
      },
      "ship": {
        "ship_01": { "name": "함선 I" },
        "ship_02": { "name": "함선 II" }
      }
    },
    "en": {
      "item": {
        "item_001": { "name": "Hydrite",   "description": "Hydrite mineral resource" },
        "item_002": { "name": "Titanium",  "description": "Mineral resource" },
        "item_003": { "name": "Copper",    "description": "Mineral resource" },
        "item_004": { "name": "Iron",      "description": "Mineral resource" },
        "item_005": { "name": "Gold",      "description": "Mineral resource" },
        "item_006": { "name": "Silicon",   "description": "Mineral resource" },
        "item_007": { "name": "Hydrogen",  "description": "Gas resource" },
        "item_008": { "name": "Helium",    "description": "Gas resource" },
        "item_009": { "name": "Xenon",     "description": "Gas resource" },
        "item_010": { "name": "Talis",     "description": "Gas resource" }
      },
      "resource": {
        "rss_001": { "name": "Hydrite Deposit",   "description": "A resource node that yields Hydrite."   },
        "rss_002": { "name": "Titanium Deposit",  "description": "A resource node that yields Titanium."  },
        "rss_003": { "name": "Copper Deposit",    "description": "A resource node that yields Copper."    },
        "rss_004": { "name": "Iron Deposit",      "description": "A resource node that yields Iron."      },
        "rss_005": { "name": "Gold Deposit",      "description": "A resource node that yields Gold."      },
        "rss_006": { "name": "Silicon Deposit",   "description": "A resource node that yields Silicon."   },
        "rss_007": { "name": "Hydrogen Field",    "description": "A decaying gas node that yields Hydrogen." },
        "rss_008": { "name": "Helium Field",      "description": "A decaying gas node that yields Helium."   },
        "rss_009": { "name": "Xenon Field",       "description": "A decaying gas node that yields Xenon."    },
        "rss_010": { "name": "Talis Field",       "description": "A decaying gas node that yields Talis."    }
      },
      "building": {
        "arc_station":             { "name": "Arc Station",              "description": "Core station with population, docking, storage, defence, power, and survival support." },
        "plasma_power_plant":      { "name": "Plasma Power Plant",       "description": "A facility that produces electrical power." },
        "beta_particle_reactor":   { "name": "Beta Particle Reactor",    "description": "A facility that produces hyperdrive energy." },
        "orbital_dorm":            { "name": "Orbital Dorm",             "description": "Habitation that provides population and workers." },
        "colony_dorm":             { "name": "Colony Dorm",              "description": "Outer habitation that provides population and workers." },
        "orbital_defence_turret":  { "name": "Orbital Defence Turret",   "description": "A defensive turret for hostile ships." },
        "sentinel_turret":         { "name": "Sentinel Turret",          "description": "A light defensive turret for hostile ships." },
        "shipyard":                { "name": "Shipyard",                 "description": "A large dock facility that builds and repairs ships." },
        "trade_port":              { "name": "Trade Port",               "description": "An economic hub where external ships dock and trade." },
        "outbase":                 { "name": "Outbase",                  "description": "A multipurpose outpost for sector expansion." },
        "hydro_synthesizer":       { "name": "Hydro-Synthesizer",        "description": "A purification plant for hydrogen synthesis and water recycling." },
        "mine":                    { "name": "Mine",                     "description": "An industrial facility that extracts minerals." },
        "refinery":                { "name": "Refinery",                 "description": "A gas refinery that extracts and purifies high-energy gases." },
        "bio_fab":                 { "name": "Bio Fab",                  "description": "A facility that produces organic resources." },
        "food_factory":            { "name": "Food Factory",             "description": "A factory that processes biological resources into food." },
        "silicon_factory":         { "name": "Silicon Factory",          "description": "A factory that produces semiconductors." },
        "weapon_factory":          { "name": "Weapon Factory",           "description": "A factory that produces ship weapon systems." },
        "advanced_weapon_factory": { "name": "Advanced Weapon Factory",  "description": "A factory for prototype and special weapon systems." }
      },
      "sector": {
        "SEC-001": { "name": "EPSILON PRIME",   "theme": "Volcanic Industrial"   },
        "SEC-002": { "name": "NOVA STATION",    "theme": "Trade Hub"             },
        "SEC-003": { "name": "CRIMSON EXPANSE", "theme": "Desert Wasteland"      },
        "SEC-004": { "name": "AZURE NEBULA",    "theme": "Gas Giant"             },
        "SEC-005": { "name": "OBSIDIAN REACH",  "theme": "Dark Matter Zone"      },
        "SEC-006": { "name": "TITAN'S GATE",    "theme": "Military Fortress"     },
        "SEC-007": { "name": "HELIOS CORE",     "theme": "Solar Forge"           },
        "SEC-008": { "name": "FROST FRONTIER",  "theme": "Ice World"             },
        "SEC-009": { "name": "EMERALD HAVEN",   "theme": "Agricultural Paradise" },
        "SEC-010": { "name": "VOID EDGE",        "theme": "Frontier Outpost"     }
      },
      "ship": {
        "ship_01": { "name": "Ship I" },
        "ship_02": { "name": "Ship II" }
      }
    }
  }
}
```

---

## 10. chunk_map.gmapdata

청크 어노테이션. 갤럭시 맵 에디터(Tab 1)가 생성.

```json
{
  "version": 2,
  "sourceGmap":         "galaxyMapData.gmap",
  "activeClusterIndex": 0,
  "chunks": {
    "12:4:7": {
      "sectorId":        "SEC-001",
      "resourceAmounts": { "rss_001": 300, "rss_002": 150 },
      "spawnFlags":      { "betaVoid": false }
    }
  }
}
```

`resourceAmounts` 값은 정수. 각 자원의 전체 풀 대비 비율로 환산.  
유효하지 않은 gmap 청크(비트=0)는 어떠한 이벤트 대상도 될 수 없다.

---

## 11. 편집 가능 범위 요약

| 파일 | 에디터 편집 | 코드 고정 / 불변 |
|------|------------|----------------|
| manifest.json | 전체 | — |
| world_config.json | 전체 | — |
| asset_registry.json | 전체 (ID → 파일 경로) | — |
| item_defs.json | type, mass | tradable, stackable (현재 전체 true) |
| resource_defs.json | 전체 | — |
| building_defs.json | identity, placement, production kind, docking, trade, visual | production 세부 로직 (recipe graph) |
| sector_defs.json | 전체 | — |
| ship_defs.json | specs, hyperdriveSpecs, 색상 | lightParts 배열 구조 (3D 메시 종속) |
| i18n.json — `system` | 읽기 전용 출력 (기본값 그대로) | `locales/ko.js`, `locales/en.js` 직접 수정 |
| i18n.json — `content` | 에디터 각 탭에서 편집 (name, description, theme) | — |
| chunk_map.gmapdata | 전체 | — |

---

## 12. 에디터 탭 구조

```
Tab 1: Galaxy Map    — 3D 뷰어 + 청크 어노테이션 (sectorId, resourceAmounts, betaVoid)
Tab 2: Sectors       — sector_defs.json 편집 (목록 + 상세 폼 + i18n content)
Tab 3: Resources     — resource_defs.json 편집 (목록 + 상세 폼 + i18n content)
Tab 4: Items         — item_defs.json 편집 (목록 + 상세 폼 + i18n content)
Tab 5: Buildings     — building_defs.json 편집 (목록 + 상세 폼 + i18n content)
Tab 6: Ships         — ship_defs.json 편집 (specs, hyperdrive, 색상 + i18n content)
Tab 7: World Config  — world_config.json 편집
Tab 8: Assets        — asset_registry.json 편집 (모델 ID → 파일 경로, BGM ID → 파일 경로)
```

**i18n 편집 원칙:**
- content(이름·설명) 편집: 각 탭 내 엔티티 상세 패널에 통합 (섹터 편집 = 이름도 같이 편집)
- system(UI 문자열) 편집: 에디터 UI 없음. `locales/ko.js`, `locales/en.js` 직접 수정
- 별도 i18n 탭 불필요

---

## 13. 정합성 규칙

| 규칙 | 등급 |
|------|------|
| chunk_map의 sectorId → sector_defs 존재 | ERROR |
| chunk_map의 resource 키 → resource_defs 존재 | ERROR |
| sector_defs의 building_id → building_defs 존재 | ERROR |
| resource_defs의 producesItemId → item_defs 존재 | ERROR |
| asset_registry의 미등록 모델 ID (ship, resource, building visual에서 참조) | WARNING |
| asset_registry의 미등록 BGM ID (sector에서 참조) | WARNING |
| 1청크 1섹터 (sectorId 중복 없음) | ERROR |
| i18n content 미입력 항목 | WARNING |
| resource totalCapacity vs 배분량 합계 이상 | INFO |

---

## 14. 구현 단계

**Phase A** — 탭 구조 + 캡슐 폴더 관리  
(showDirectoryPicker, 9개 파일 읽기/쓰기, 기존 갤럭시 맵 탭 통합)

**Phase B** — 섹터 / 자원 / 아이템 에디터 (Tab 2, 3, 4)  
(비교적 단순한 스키마 — 한 번에 작업)

**Phase C** — 건물 에디터 (Tab 5)  
(placement, production kind, trade 등 복잡도 높음 — 별도 단계)

**Phase D** — 함선 에디터 (Tab 6) + 월드 설정 (Tab 7)

**Phase E** — 정합성 검사 + 내보내기 + **포맷 Freeze 선언**
