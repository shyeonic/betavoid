# Post Build Design Document

***본 문서는 '00_Guide.md'의 하위 문서이다. 본 문서는 개발 후 기획서(PBDD)로, 대화 기록이 아니라 현재 코드에 존재하는 구현을 기준으로 작성한다.***

## 1. 문서 목적

beta-void의 현재 구현 상태를 기준으로 완료된 시스템, 주요 의사결정, 구현상 제약, 후속 기획 후보를 기록한다. 본 문서는 개발 지시서가 아니라 현재 코드베이스를 바탕으로 한 상태 기록이며, 향후 기획/개발 판단 시 근거 문서로 사용한다.

분량이 큰 영역은 `DesignDocuments/PBDD/PBDD_{name}.md` 별도 문서로 분리한다. 본 문서는 전체 개요와 각 하위 문서로의 진입점 역할을 한다.

## 2. 현재 빌드 개요

- 프로젝트는 `index.html`을 진입점으로 하는 브라우저 기반 3D 우주 비행 프로토타입이다.
- 진입 모듈은 `js/main.js` 단일 ES 모듈이며, Three.js는 importmap을 통해 CDN(`three@0.165.0`)에서 로드한다.
- 기동 시 `js/GameDataLoader.js`가 `gamedata/` 폴더의 콘텐츠 데이터를 로드·정규화하여 단일 `gameData` 객체를 만들고, 이를 `GameManager`에 주입한다. **데이터 로드 실패 시 게임은 시작되지 않는다.**
- 게임 런타임의 중심 제어자는 `js/GameManager.js`이며, 리소스 로딩, UI, 사운드, 월드 데이터, 월드 렌더링, 함선 비주얼, 미니맵, 항법/하이퍼드라이브를 조합한다.
- 콘텐츠(섹터/자원/건물/함선/다국어/월드 구조)는 `gamedata/` 데이터 파일로 정의된다(데이터 주도형). 런타임 코드는 이 데이터를 로드·소비할 뿐 콘텐츠를 코드로 포함하지 않는다.
- 런타임 월드 상태(생성된 월드/플레이어/항법 로그)는 브라우저 IndexedDB에 저장되며, 로컬 가상 서버/SSoT 역할을 한다.
- 환경 비주얼은 라이트/다크 두 프리셋과 사용자 조절 가능한 성능 설정을 가진다.
- PC 키보드/마우스와 모바일 터치 입력을 함께 고려한 UI/조작 체계가 구현되어 있다.
- 다국어(i18n) 기반이 구축되어 있다(en/ko).

## 3. 구현 모듈 구성

진입점 `js/main.js` → `GameDataLoader.loadGameData()` → `GameManager`. GameManager가 아래 매니저를 소유한다.

### 3.1 GameManager
- 파일: `js/GameManager.js`
- 역할: 전체 게임 생명주기, Three.js 씬, 플레이어 함선, 카메라, 입력, 항법/하이퍼드라이브, 저장, 월드/사운드/UI/미니맵/함선비주얼 연동.
- 주요 상태: `standby`/`loading`/`ready`/`running` 단계, 현재/목표 속도, 자동항법 단계, 하이퍼드라이브 상태, 카메라 모드, 환경 모드, 성능 설정, 활성 액션 집합, 활성 항법 로그 ID.

### 3.2 GameDataLoader
- 파일: `js/GameDataLoader.js`
- 역할: `gamedata/` 정의/gmap/다국어/에셋 레지스트리 로드·정규화, 클러스터링, `dataSourceKey` 산출.
- 상세: `PBDD/PBDD_GameData.md`

### 3.3 UIManager
- 파일: `js/UIManager.js`
- 역할: 시작 게이트/로딩/준비 화면, 설정(키바인딩/데이터/언어) 팝업, HUD, 속도 게이지, 좌표 입력, 스캐너 목록, 함선 선택 팝업, 토스트, 터치 D-pad, 다국어 정적 텍스트.
- 상세: `PBDD/PBDD_UI.md`

### 3.4 WorldDataManager
- 파일: `js/WorldDataManager.js`
- 역할: IndexedDB 스키마, 월드 생성/저장/조회, 자원 스폰 사이클, 베타보이드 생명주기, 플레이어 상태/항법 로그.
- DB 이름 `beta-void`, 버전 `6`. 스토어: `sectors`, `chunks`, `resourceNodes`, `buildings`, `betaVoids`, `meta`, `settings`, `navLogs`.
- 상세: `PBDD/PBDD_WorldData.md`

### 3.5 WorldMapManager
- 파일: `js/WorldMapManager.js`
- 역할: 월드 스냅샷을 Three.js 오브젝트로 변환, 플레이어 주변 청크만 렌더, 섹터/청크 경계선·오브젝트·가시 청크 관리.
- 상세: `PBDD/PBDD_WorldObjectRenderOptimization.md`

### 3.6 ResourceManager
- 파일: `js/ResourceManager.js`
- 역할: GLB(GLTF+DRACO) 모델, 오디오, 버퍼 로딩·캐싱, 진행률 추적. OBJ/MTL은 레거시 폴백.
- 상세: `PBDD/PBDD_AudioResource.md`

### 3.7 SoundManager
- 파일: `js/SoundManager.js`
- 역할: BGM(media audio), 효과음(Web Audio buffer), 위치 기반 BGM 전환, 에셋 레지스트리 적용.
- 상세: `PBDD/PBDD_AudioResource.md`

### 3.8 ShipVisualManager
- 파일: `js/ShipVisualManager.js`
- 역할: 함선 발광 표면, 하이라이트 색, 글로우 스프라이트/포인트 광원, 엔진 출력 연동 VFX.
- 상세: `PBDD/PBDD_Rendering.md`

### 3.9 렌더 파이프라인 보조 모듈
- `js/BloomRenderPipeline.js` — EffectComposer 기반 선택적 블룸
- `js/HyperdriveWarpLayer.js` — 워프 스트릭/비네팅 연출
- `js/TargetingOverlay.js` — 2D 캔버스 타겟 락 프레임
- 상세: `PBDD/PBDD_Rendering.md`

### 3.10 MinimapManager
- 파일: `js/MinimapManager.js`
- 역할: 별도 Three.js 렌더러로 은하/클러스터/섹터 3단 줌 지도, 마커, 환경 테마 동기화.
- 상세: `PBDD/PBDD_UI.md`

### 3.11 i18n
- 파일: `js/i18n/i18n.js`, `js/i18n/localeRegistry.js`, `js/i18n/locales/{en,ko}.js`
- 역할: 로케일 감지/전환, 키 기반 번역, 정의 텍스트 해석, 카탈로그 검증.
- 상세: `04_I18nFoundationPlan.md`, `PBDD/PBDD_GameData.md` 9절

### 3.12 설정 및 런타임 상수
- `js/config.js`: 카메라/키 바인딩/에셋 기본 경로(`ASSETS`). 함선 비행 specs는 gamedata(`ship_defs.json`)에 정의된다.
- `js/worldDefinitions.js`: `WORLD_CONFIG`(DB 이름/버전, 청크 크기/그리드, 렌더 스케일, 배치 거리, 점검 주기, 베타보이드 active reset 범위).
- `js/definitions/environmentDefinitions.js`: 환경 프리셋, 블룸 품질, 성능 설정.

## 4. 완료된 주요 기능

### 4.1 데이터 주도형 콘텐츠 파이프라인
- 섹터/자원/건물/아이템/함선/다국어/월드 구조가 `gamedata/`의 JSON·gmap 파일로 정의되어 로드된다.
- 콘텐츠 변경 시 `dataSourceKey` 비교로 월드가 자동 재생성된다.
- 상세: `PBDD/PBDD_GameData.md`

### 4.2 Three.js 기반 3D 비행 화면
- WebGLRenderer, PerspectiveCamera, Scene, fog, 조명, 별 레이어, 선택적 블룸이 구성되어 있다.
- 함선 GLB 모델을 불러와 중심 보정 후 배치하고, 발광/하이라이트/광원 VFX를 적용한다.
- 매 프레임 `requestAnimationFrame` 루프에서 입력, 이동, 카메라, 월드 렌더링, HUD, 저장을 갱신한다.

### 4.3 수동 비행 조작
- 키보드 입력으로 pitch/yaw/roll/strafe/ascend/descend/throttle 조작.
- 기본 키 바인딩은 설정 UI에서 변경 가능하며 `localStorage`의 `beta-void-key-bindings`에 저장된다.
- 입력 충돌 시 중복 키를 정규화한다.
- 상세: `PBDD/PBDD_InputCamera.md`

### 4.4 속도 시스템
- 현재 속도와 목표 속도를 분리한다.
- 속도 범위/가감속률은 함선 specs(gamedata)로 정의된다(기본 함선: max 100, min -20).
- HUD 속도 게이지는 pointer/keyboard 입력을 모두 지원한다.

### 4.5 자동항법 시스템
- 좌표 입력 또는 스캐너 오브젝트 선택으로 항법을 시작한다.
- 단계: `stopping`/`aligning`/`accelerating`/`cruising`/`decelerating`.
- 거리·가감속률 기반 최고속도·ETA 계산, 수동 조작 시 취소, 항법 로그 기록.
- 상세: `PBDD/PBDD_Navigation.md`

### 4.6 결정론적 항법 및 비활성화 복원
- 플레이어 상태는 `meta/playerShip`에 1000ms 주기로 저장된다.
- 항법 이벤트는 `navLogs`에 타임스탬프 기반으로 기록된다.
- 탭 전환·이탈 시 비활성화 로그(`deactivation`)를 즉시 발행하고, 복귀 시 경과 시간으로 위치를 역산한다.
- 자동항해는 `flight_start_at` 기반 완전 결정론적 역산으로 복원된다.
- 상세: `PBDD/PBDD_Navigation.md`

### 4.7 하이퍼드라이브 워프 항법
- 장거리 도약을 `stopping → aligning → cooldown → warp(entry/cruise/exit)` 단계로 처리한다.
- 단계 시작 시각을 사전 계산해 `type: "hyperdrive"` navLog에 저장하고, smoothstep 이징으로 위치를 결정론적으로 역산한다.
- 점프 시작 전까지만 취소 가능. 워프 연출은 `HyperdriveWarpLayer`가 담당한다.
- 상세: `PBDD/PBDD_InputCamera.md`(항법), `PBDD/PBDD_Rendering.md`(연출)

### 4.8 카메라 시스템
- follow(추적)/orbit(궤도)/target(대상 추적) 3모드.
- `C`·하단 버튼으로 follow↔orbit 전환(토글 SFX), 드래그/휠/핀치로 회전·거리 조절, follow 복귀 보간.
- 상세: `PBDD/PBDD_InputCamera.md`

### 4.9 모바일 터치 입력
- follow 모드 단일 터치는 D-pad(pitch/yaw 아날로그)로 처리, 두 손가락은 pinch/zoom·orbit으로 전환.
- 상세: `PBDD/PBDD_InputCamera.md`

### 4.10 월드 데이터 생성
- 시드 기반 난수로 생성되며, 생성 seed와 `data_source_key`가 `meta/world`에 저장된다.
- 청크 그리드는 `10 × 10 × 10 = 1000`개, 청크 크기는 각 축 `400000` 데이터 단위.
- 섹터/자원/건물 정의는 `gamedata/`에서 로드되며, 활성 청크는 `galaxyMapData.gmap`(비트마스크)과 `chunk_map.gmapdata`(클러스터 활성화)로 결정된다.
- 섹터 ID 체계는 `SEC-001`~`SEC-010`(현재 10개 섹터), 자원은 `rss_001`.., 아이템은 `item_001`.., 함선은 `ship_01`/`ship_02`, 건물은 `arc_station`/`mine`/`refinery` 등.
- 상세: `PBDD/PBDD_WorldData.md`, `PBDD/PBDD_GameData.md`

### 4.11 자원 및 건물 배치
- 자원은 섹터 `resource_weights`·자원 `sector_ratio` 기반, 또는 `chunk_map` 주석 기반으로 배치된다.
- 건물은 섹터의 `initial_buildings`/`initial_resource_facilities`를 배치 규칙(`placement_rule`)에 따라 배치한다.
- 베타보이드는 섹터 `beta_void_count`만큼 배치된다.
- 배치 시 최소 거리 검사로 과밀을 줄인다.
- 상세: `PBDD/PBDD_WorldData.md`

### 4.12 살아있는 세상 사이클
- 자원 점검·스폰 사이클(`checkAndSpawnResources`, 기본 24시간 주기, `meta/resourceManager` 풀 관리)이 구현되어 있다.
- 베타보이드 생명주기는 `active` 자연 초기화와 `defeated` 재출현의 두 타이머를 가진다.
- active 베타보이드는 30~240분 범위의 `active_reset_at`이 지나면 상태를 유지한 채 새 위치/variant로 초기화된다.
- defeated 베타보이드는 다음 6시간 정각 체크포인트(`00:00/06:00/12:00/18:00`)에 active로 재출현한다.
- 두 사이클 모두 접속 시점 및 런타임 점검 시 경과 시간으로 결정론적으로 처리된다.
- 상세: `PBDD/PBDD_WorldData.md`

#### 4.12.1 BetaSpace 런타임 인스턴스
- active 베타보이드와 상호작용하면 `BetaSpaceManager`가 메모리 전용 BetaSpace 스냅샷을 생성한다.
- BetaSpace는 기본 청크 크기의 `5×5×5` 공간이며, 현재 단계에서는 내부 자원/건물/적 콘텐츠 없이 진입과 탈출만 제공한다.
- BetaVoid의 `active_reset_at`이 BetaSpace 제한시간이다. 제한시간 만료 시 진입 전 alpha 위치/회전/속도 상태로 강제 탈출한다.
- 수동 탈출도 같은 반환 상태를 사용하며, 세션 객체를 폐기하므로 BetaSpace 내부 상태는 매번 초기화된다.
- BetaSpace 안에서는 alpha 플레이어 저장과 alpha navLog 기록을 중지한다. 일반 자동항해는 메모리 로그만 사용하고, 하이퍼드라이브는 현재 비활성화한다.
- 5청크 안전 경계를 벗어나면 10초 grace를 세고, 복귀하지 않으면 `gameOverAssumed` 플래그와 토스트/HUD 표시만 수행한다.
- UI는 상단 중앙 `.beta-space-hud`에 남은 시간과 Exit 버튼을 표시한다.

### 4.13 청크 기반 렌더링
- 렌더 좌표는 데이터 좌표 × `renderScale(0.01)`.
- 플레이어 청크 기준 `renderChunkRadius(2)` 범위(최대 `5×5×5=125`)를 렌더한다.
- 가시 청크 변경은 diff 기반 추가/제거, 오브젝트 생성은 프레임 예산 큐로 분산.
- 청크/섹터 경계 표시 모드(All/Sector/Off).
- 상세: `PBDD/PBDD_WorldObjectRenderOptimization.md`

### 4.14 스캐너/오브젝트 목록
- 하단 Scan 버튼으로 스캐너 팝업을 연다.
- 자원/건물/베타보이드를 카테고리로 분리하고 정렬·선택·상세를 제공한다.
- 상세에서 항법 또는 하이퍼드라이브를 시작할 수 있다.
- 상세: `PBDD/PBDD_UI.md`

### 4.15 환경 모드 및 성능 설정
- 라이트/다크 환경 프리셋(톤매핑/조명/포그/타겟색/파티클색)과 CSS 변수 연동.
- 성능 설정(머티리얼 맵/렌더 해상도/블룸 품질/광원 이펙트/AA)을 사용자 노출.
- 상세: `PBDD/PBDD_Rendering.md`

### 4.16 설정 및 데이터 관리
- 시작 화면 설정 팝업: Key Binding / Data / Language 탭.
- Data 탭: seed, 생성일, 섹터/청크/자원/건물 수, 현재 섹터/청크. 월드 재생성, DB 리로드, 전체 초기화.
- 데이터 초기화는 `reset` URL 파라미터로 캐시·IndexedDB·`beta-void-` prefix 스토리지를 삭제 후 재진입.
- 상세: `PBDD/PBDD_UI.md`, `PBDD/PBDD_WorldData.md`

### 4.17 사운드 시스템
- 메인/섹터/위험 BGM, 카메라 토글 SFX.
- 위치 맥락(섹터 내부/청크 내부/월드 외부)에 따라 BGM 선택. 시작 게이트 이후 재생.
- 상세: `PBDD/PBDD_AudioResource.md`

### 4.18 시작/로딩 플로우
- `Click anywhere` 게이트 → 함선/월드 모델·사운드·월드 DB 로드 → Start 버튼 → running.
- 리소스 진행률 UI와 warning toast.
- 상세: `PBDD/PBDD_UI.md`

### 4.19 다국어(i18n)
- en/ko 카탈로그(코드 기본값 + `gamedata/i18n.json` 오버라이드).
- 로케일 감지/전환, 정의 텍스트 해석, 카탈로그 검증.
- 상세: `04_I18nFoundationPlan.md`, `PBDD/PBDD_GameData.md` 9절

## 5. 주요 의사결정 기록

### 5.1 콘텐츠를 외부 데이터로 분리
- 섹터/자원/건물/함선/다국어/월드 구조를 `gamedata/` 데이터 파일로 관리하며, 에디터(`Editors/`)로 편집한다.
- 코드 수정 없이 콘텐츠를 변경할 수 있고, 데이터 서명(`dataSourceKey`)으로 변경 시 월드를 자동 재생성한다.

### 5.2 로컬 IndexedDB를 권위 저장소로 사용
- 정의 데이터는 읽기 전용 입력, IndexedDB는 가변 월드 상태(SSoT).
- 멀티플레이어 서버 확장 시 store 단위를 서버 테이블/컬렉션으로 대응시키기 쉽다(`05_CostEfficientAuthoritativeServerPlan.md`).

### 5.3 월드 좌표와 렌더 좌표 분리
- 데이터 좌표는 큰 단위, 렌더 좌표는 `renderScale`로 축소. 큰 월드 스케일과 렌더 안정성을 동시 확보.

### 5.4 청크 중심 가시 범위 렌더링
- 전체 월드 대신 플레이어 주변 청크만 렌더(반경 2, 최대 125). 오브젝트 생성은 프레임 큐로 분산, 가시 청크 변경은 diff 처리.
- 표시 순서를 강제하는 결정이 아니라 작업 부하 분산 결정이다(`PBDD/PBDD_WorldObjectRenderOptimization.md`).

### 5.5 항법을 상태 기계로, 시간 기반 결정론으로 구현
- 자동항법·하이퍼드라이브를 단계형 상태 기계로 구현하고, 단계 시각을 사전 계산해 결정론적으로 역산한다.
- 클라이언트 부재 구간도 동일 원칙으로 처리한다(`PBDD/PBDD_Navigation.md`).

### 5.6 PC와 모바일을 하나의 입력 추상화로 통합
- 키보드·터치 D-pad를 공통 액션 이름으로 변환. `activeActions`/`getControlActionAmount`가 통합 지점.

### 5.7 리소스 로딩을 명시적 시작 입력 뒤에 배치
- 브라우저 오디오 정책·UX를 고려해 최초 입력 이후 로딩·오디오 준비. BGM도 Start 이후 재생.

### 5.8 모델 포맷을 GLB로 통일
- 함선·건물·자원 모델은 GLB(+DRACO)를 사용하고 OBJ/MTL은 폴백 경로로 지원한다. 에셋 경로는 `asset_registry.json`으로 간접화한다.

### 5.9 비주얼을 데이터 프리셋으로 모드화
- 라이트/다크 환경을 코드 분기 대신 프리셋 객체로 정의하고, 성능 설정을 사용자에게 노출(저사양 대응).

## 6. Kickoff 기준 반영 상태

### 6.1 PC-Mobile 멀티플랫폼
- 반영됨. `vh`/`dvh`/`clamp()` 크기, pointer/touch 입력, 키보드/마우스/D-pad/pinch zoom.

### 6.2 살아있는 세상
- 부분 반영. 자원 점검·스폰 사이클과 베타보이드 생명주기(접속 시점 결정론적 처리)가 구현되어 있다.
- 단, 플레이어 상호작용 기반 채굴/소비/고갈 루프와 경제 순환은 아직 없다.

### 6.3 결정론적 시스템
- 부분 반영. 시드 기반 월드 생성, IndexedDB SSoT, 항법/하이퍼드라이브 타임스탬프 결정론.
- 단, 모든 수동 액션을 집계하는 명령 로그/명령 큐는 아직 없다.

### 6.4 청크 기반 좌표공간
- 반영됨. 1000개 청크, 플레이어 주변 렌더, 클러스터링 기반 미니맵 줌.
- 원거리 단순 표현(Diegetic LoD)은 별도 시스템으로 미구현.

## 7. 현재 데이터 모델 요약

런타임 인스턴스 모델 상세는 `PBDD/PBDD_WorldData.md` 8절, 정의(콘텐츠) 모델은 `PBDD/PBDD_GameData.md` 및 `DefinitionCatalog/` 참조.

- **Sector**: `sector_id`, `name`, `theme`, `theme_music_id`, `chunk_id`, `resource_weights`, `global_bounds`, `chunk_bounds` 등. ID `SEC-001`~`SEC-010`(10개).
- **Chunk**: `chunk_id`(`x:y:z`), `position`, `global_bounds`, `sector_id`, `object_counts`.
- **ResourceNode**: `resource_instance_id`, `resource_id`/`type`, `model_id`, `position`, `total_capacity`, `current_amount`, `base_yield_per_sec` 등. ID `rss_001`..
- **Building**: `building_instance_id`, `building_id`, `model_id`, `position`, `hp`, `status` 등. 자원시설은 `resource_id`/`current_amount` 추가.
- **BetaVoid**: `id`, `sector_id`, `position`, `status`(`active`/`defeated`), `variant_id`, `variant_generation`, `enemy_type`, `risk_level`, `reward_table_id`, `active_reset_at`, `defeated_at`, `next_regeneration_checkpoint`.
- **PlayerShip**(`meta/playerShip`): `ship_id`, `position`, `rotation`, `speed`, `desiredSpeed`, `updated_at` 등.
- **NavLog**(`navLogs`): `standard`/`deactivation`/`hyperdrive`. 상세는 `PBDD/PBDD_Navigation.md`, 하이퍼드라이브는 `PBDD/PBDD_InputCamera.md`.

## 8. 현재 제약 및 후속 기획 후보

- 플레이어 상호작용 기반 자원 채굴/소비/고갈 루프는 아직 없다(스폰·총량 집계 수준).
- 베타보이드 격파 상호작용(전투)은 미구현이며 생명주기 상태 전이 구조만 존재한다.
- 모든 수동 액션을 로그화하는 결정론적 명령 시스템은 아직 없다.
- 멀티플레이어 동기화 계층은 아직 없다.
- 섹터는 청크 1개에 매핑되며 다중 청크·계층형 공간 구조는 없다.
- Diegetic LoD는 Kickoff에 명시되어 있으나 미구현이다.
- 충돌 판정, 건설, 인벤토리, 거래, 경제 시스템은 구현 범위 밖이다.
- 콘텐츠 재생성이 플레이어 진행 상태를 보존하지 않는다.
- `config.js` `ASSETS`와 `asset_registry.json`이 함선/사운드 경로를 이중 정의한다.
- 테스트 자동화는 명시적 스크립트가 없다.

## 9. 하위 PBDD 문서 목록

| 문서 | 범위 | 상태 |
|------|------|------|
| `PBDD/PBDD_GameData.md` | gamedata 파이프라인, GameDataLoader, gmap/클러스터링, 정의 정규화, 에셋 레지스트리, dataSourceKey | ✅ |
| `PBDD/PBDD_WorldData.md` | IndexedDB SSoT, 월드 생성, 자원 스폰·베타보이드 사이클, 런타임 데이터 모델 | ✅ |
| `PBDD/PBDD_Navigation.md` | 자동항해, 비활성화 항법, 결정론적 복원, 항법 로그 | ✅ |
| `PBDD/PBDD_InputCamera.md` | PC/모바일 입력, 액션 추상화, 카메라 모드, 하이퍼드라이브 | ✅ |
| `PBDD/PBDD_Rendering.md` | 환경 프리셋, 블룸, 성능 설정, 함선 VFX, 워프 연출, 타겟팅 | ✅ |
| `PBDD/PBDD_UI.md` | HUD, 시작/로딩, 설정, 스캐너, 미니맵 | ✅ |
| `PBDD/PBDD_AudioResource.md` | 리소스 로딩(GLB), 사운드 정책 | ✅ |
| `PBDD/PBDD_WorldObjectRenderOptimization.md` | 월드 오브젝트 렌더 큐, visible chunk diff 최적화 | ✅ |

### 후속 문서화 후보
- `PBDD/PBDD_Hyperdrive.md`: 하이퍼드라이브가 더 확장되면 `PBDD_InputCamera.md`에서 분리.
- `PBDD/PBDD_LivingWorld.md`: 자원/베타보이드 사이클이 상호작용 루프로 확장되면 `PBDD_WorldData.md`에서 분리.
