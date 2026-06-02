# Post Build Design Document

***본 문서는 '00_Guide.md'의 하위 문서이다. 본 문서는 개발 후 기획서(PBDD)로, 대화 기록이 아니라 현재 코드에 존재하는 구현을 기준으로 작성한다.***

## 1. 문서 목적

Void Zero의 현재 구현 상태를 기준으로 완료된 시스템, 주요 의사결정, 구현상 제약, 후속 기획 후보를 기록한다. 본 문서는 개발 지시서가 아니라 현재 코드베이스를 바탕으로 한 상태 기록이며, 향후 기획/개발 판단 시 근거 문서로 사용한다.

## 2. 현재 빌드 개요

- 프로젝트는 `index.html`을 진입점으로 하는 브라우저 기반 3D 우주 비행 프로토타입이다.
- 렌더링 및 비행 시뮬레이션은 Three.js 기반으로 구성되어 있다.
- 게임 런타임의 중심 제어자는 `js/GameManager.js`이며, 리소스 로딩, UI, 사운드, 월드 데이터, 월드 렌더링 관리자를 조합한다.
- 월드 데이터는 브라우저 IndexedDB에 저장되며, 로컬 가상 서버/SSoT 역할을 한다.
- PC 키보드/마우스와 모바일 터치 입력을 함께 고려한 UI/조작 체계가 구현되어 있다.

## 3. 구현 모듈 구성

### 3.1 GameManager

- 파일: `js/GameManager.js`
- 역할: 전체 게임 생명주기, Three.js 씬, 플레이어 함선, 카메라, 입력, 항법, 저장, 월드/사운드/UI 연동을 담당한다.
- 주요 상태:
  - `standby`, `loading`, `ready`, `running` 단계
  - 현재 속도와 목표 속도
  - 자동항법 단계
  - 카메라 모드 및 터치 포인터 상태
  - 활성 키 입력 집합
  - 활성 항법 로그 ID

### 3.2 UIManager

- 파일: `js/UIManager.js`
- 역할: 시작 게이트, 로딩/준비 화면, 설정 팝업, HUD, 속도 게이지, 좌표 입력, 스캐너 목록, 토스트, 터치 D-pad를 관리한다.
- UI는 `vh`, `dvh`, `clamp()` 등을 적극 사용하여 다양한 화면비에 대응한다.
- 스캐너 UI는 자원/건물 카테고리, 정렬, 행 선택, 상세 버블, 항법 연계를 제공한다.

### 3.3 WorldDataManager

- 파일: `js/WorldDataManager.js`
- 역할: IndexedDB 스키마 관리, 월드 생성/저장/조회, 플레이어 함선 상태 저장, 항법 로그 기록을 담당한다.
- 데이터베이스 이름은 `void-zero-world`, 버전은 `4`이다.
- 저장소:
  - `sectors`
  - `chunks`
  - `resourceNodes`
  - `buildings`
  - `meta`
  - `settings`
  - `navLogs`

### 3.4 WorldMapManager

- 파일: `js/WorldMapManager.js`
- 역할: 월드 데이터 스냅샷을 Three.js 오브젝트로 변환하고, 현재 위치 주변 청크만 렌더링한다.
- 섹터/청크 경계선, 자원/건물 오브젝트, 오브젝트 위치 캐시, 가시 청크 집합을 관리한다.

### 3.5 ResourceManager

- 파일: `js/ResourceManager.js`
- 역할: OBJ/MTL 모델, 오디오 Blob, ArrayBuffer 리소스를 로딩하고 캐싱한다.
- 함선 모델은 로컬 파일을 우선 사용하고, 실패 시 원격 fallback URL을 시도한다.
- 월드 모델은 OBJ/MTL 조합을 지원하며, 실패 시 렌더러 쪽에서 fallback mesh를 사용할 수 있다.

### 3.6 SoundManager

- 파일: `js/SoundManager.js`
- 역할: BGM, 위치별 BGM 전환, 효과음 재생을 담당한다.
- BGM은 media audio 기반, 카메라 토글 효과음은 Web Audio buffer 기반으로 처리한다.

### 3.7 설정 및 정의 파일

- `js/config.js`: 비행 속도, 회전율, 카메라, 키 바인딩, 리소스 경로 정의
- `js/worldDefinitions.js`: 월드 크기, 청크 크기, 섹터 템플릿, 자원/건물 정의

## 4. 완료된 주요 기능

### 4.1 Three.js 기반 3D 비행 화면

- WebGLRenderer, PerspectiveCamera, Scene, fog, 조명, 별 레이어가 구성되어 있다.
- 플레이어 함선 OBJ 모델을 불러와 중심 보정 후 씬에 배치한다.
- 매 프레임 `requestAnimationFrame` 루프에서 입력, 이동, 카메라, 월드 렌더링, HUD, 저장을 갱신한다.

### 4.2 수동 비행 조작

- 키보드 입력으로 pitch, yaw, roll, strafe, ascend, descend, throttle 조작을 수행한다.
- 기본 키 바인딩은 `PageUp`, `PageDown`, `Home`, `End`, 방향키, `Q/E`, `WASD`, `C`로 정의되어 있다.
- 키 바인딩은 설정 UI에서 변경할 수 있으며 `localStorage`의 `void-zero-key-bindings`에 저장된다.
- 입력 충돌 시 중복 키를 정규화하여 기본값 또는 사용 가능한 키로 보정한다.

### 4.3 속도 시스템

- 현재 속도와 목표 속도를 분리한다.
- 목표 속도는 최소 `-20`, 최대 `100` 범위에서 제한된다.
- 가속/감속은 `accelerationRate`, `decelerationRate`, `throttleAdjustRate`에 따라 시간 기반으로 보간된다.
- HUD 속도 게이지는 pointer와 keyboard 입력을 모두 지원한다.

### 4.4 자동항법 시스템

- 좌표 입력 또는 스캐너 오브젝트 선택을 통해 목표 지점으로 항법을 시작할 수 있다.
- 자동항법 단계는 `stopping`, `aligning`, `accelerating`, `cruising`, `decelerating`으로 나뉜다.
- 목표 도착 반경은 `arrivalRadius`로 관리된다.
- 자동항법은 거리, 가속률, 감속률을 바탕으로 최고 속도와 ETA를 계산한다.
- 자동항법 중 특정 수동 조작이 발생하면 항법을 취소한다.
- 자동항법 로그는 `navLogs` 저장소에 기록되며, 진행 중인 항법은 재접속 시 복원 계산에 사용된다.

### 4.5 결정론적 항법 및 비활성화 복원

- 플레이어 함선 위치, 회전, 속도, 목표 속도는 `meta/playerShip`에 `playerShipSaveInterval = 1000ms` 주기로 저장된다.
- 모든 항법 이벤트(자동항해 시작·완료, 비활성화 이탈·복귀)는 `navLogs`에 타임스탬프 기반 로그로 기록된다.
- 탭 전환·페이지 이탈 시 비활성화 항해 로그(`type: "deactivation"`)를 즉시 발행하고, 복귀 시 경과 시간으로 위치를 역산한다.
- 비활성화 물리는 3단계: 목표속도 전이 → 등속 유지(`deactivationCoastDuration: 600초`) → 감속 정지.
- 자동항해는 `flight_start_at` 타임스탬프 기반 수식으로 완전 결정론적 역산이 가능하므로 별도 비활성화 처리 없이 복원된다.
- 상세 구현: `PBDD/PBDD_Navigation.md` 참조

### 4.6 카메라 시스템

- 기본 카메라는 함선 추적 모드이다.
- `C` 또는 하단 중앙 버튼으로 orbit 카메라와 follow 카메라를 전환한다.
- 마우스 드래그/터치 드래그로 orbit 카메라 회전을 수행한다.
- 휠/핀치 제스처로 카메라 거리를 조절한다.
- follow 복귀 시 카메라 보간 복귀가 적용된다.
- 카메라 토글 시 효과음이 재생된다.

### 4.7 모바일 터치 입력

- 터치 환경에서 follow 카메라 모드의 단일 터치는 D-pad 조작으로 처리된다.
- D-pad는 pitch/yaw 아날로그 입력값을 생성한다.
- 두 손가락 입력은 카메라 pinch/zoom 또는 orbit 조작으로 전환된다.
- 화면 UI는 pointer event, touch-action, vh 기반 크기를 사용한다.

### 4.8 월드 데이터 생성

- 월드는 시드 기반 난수로 생성된다.
- 현재 기본 생성 시드는 `Date.now()`이며, 생성된 seed는 `meta/world`에 저장된다.
- 청크 그리드는 `10 x 10 x 10`으로 총 1000개 청크를 생성한다.
- 청크 크기는 각 축 `400000` 데이터 단위이다.
- 섹터는 현재 4개 템플릿으로 정의된다.
  - `SEC-001 / Epsilon Prime / Industrial`
  - `SEC-002 / Nova Station / Command`
  - `SEC-003 / Azure Nebula / Gas Field`
  - `SEC-004 / Frost Frontier / Ice Belt`
- 각 섹터는 생성 시 임의 청크 하나에 배정된다.

### 4.9 자원 및 건물 배치

- 초기 자원 타입은 `gas1`, `gas2`, `ore1`, `ore2`, `water1`, `water2`이다.
- 초기 건물 타입은 `hq1`, `hq2`이다.
- 자원은 섹터별 `resource_weights`를 참고하여 배치된다.
- 자원은 `total_capacity`, `current_amount`, `base_yield_per_sec`, `spawn_time`을 가진다.
- 건물은 `hp`, `status`, `created_at`을 가진다.
- 배치 시 최소 거리 검사를 수행하여 오브젝트 간 과밀 배치를 줄인다.

### 4.10 청크 기반 렌더링

- 렌더링 좌표는 데이터 좌표에 `renderScale = 0.01`을 곱해 변환한다.
- 플레이어가 속한 청크를 기준으로 `renderChunkRadius = 2` 범위의 청크를 렌더링 대상으로 삼는다.
- 3D 청크 공간 기준 최대 후보 범위는 `5 x 5 x 5 = 125`개 청크이다.
- 가시 청크 변경 시 유지되는 청크의 오브젝트는 보존하고, 빠진 청크만 제거하며, 새로 들어온 청크만 렌더 작업 큐에 등록한다.
- 자원/건물 오브젝트는 한 프레임에 모두 생성하지 않고 `WorldMapManager`의 오브젝트 생성 큐에서 프레임 예산에 따라 순차 생성한다.
- 자원 오브젝트는 회전 애니메이션을 가진다.
- 청크 경계 표시 모드는 `All`, `Sector`, `Off`로 제공된다.

### 4.11 스캐너/오브젝트 목록

- 하단 메뉴의 Scan 버튼을 통해 스캐너 팝업을 열 수 있다.
- 스캐너는 자원과 건물을 카테고리로 분리한다.
- 자원 항목은 타입, 보유량/총량, 섹터, 청크, 거리 정보를 표시한다.
- 건물 항목은 이름, HP, 상태, 섹터, 청크, 거리 정보를 표시한다.
- 목록은 섹터/이름/거리/수량/상태 등 카테고리별 기준으로 정렬할 수 있다.
- 오브젝트 상세 버블에서 해당 오브젝트로 항법을 시작할 수 있다.

### 4.12 설정 및 데이터 관리

- 시작 화면에서 설정 팝업을 열 수 있다.
- 설정은 `Key Binding` 탭과 `Data` 탭으로 구성된다.
- Data 탭은 seed, generated date, 섹터 수, 청크 수, 자원 수, 건물 수, 현재 섹터/청크를 표시한다.
- 월드 재생성, DB 리로드, 전체 데이터 초기화가 가능하다.
- 데이터 초기화는 `reset` URL 파라미터를 이용해 런타임 캐시와 IndexedDB 삭제를 수행한 뒤 페이지를 재진입한다.
- `void-zero-` prefix를 가진 localStorage/sessionStorage 항목도 초기화 대상이다.

### 4.13 사운드 시스템

- 메인 BGM, 섹터 BGM, 위험 BGM, 카메라 토글 SFX가 정의되어 있다.
- 현재 위치가 섹터 내부인지, 알려진 청크 내부인지, 월드 외부인지에 따라 BGM을 선택한다.
- 사운드는 사용자의 시작 입력 이후 재생되도록 시작 게이트 뒤에 묶여 있다.

### 4.14 시작/로딩 플로우

- 최초 진입 시 `Click anywhere` 게이트가 표시된다.
- 입력 후 함선 모델, 월드 모델, 사운드, 월드 DB를 로드한다.
- 최소 로딩 표시 시간은 1100ms이다.
- 리소스 로딩 결과는 진행률 UI와 warning toast로 표시된다.
- 로딩 완료 후 Start 버튼으로 실제 게임 루프를 running 상태로 전환한다.

## 5. 주요 의사결정 기록

### 5.1 로컬 IndexedDB를 권위 저장소로 사용

- 월드, 플레이어 상태, 설정, 항법 로그는 브라우저 IndexedDB에 저장된다.
- 서버가 없는 현재 빌드에서도 SSoT와 유사한 구조를 확보하기 위한 결정이다.
- 추후 멀티플레이어 서버로 확장할 때 IndexedDB 저장소의 store 단위를 서버 테이블/컬렉션으로 대응시키기 쉽다.

### 5.2 월드 좌표와 렌더 좌표 분리

- 데이터 좌표는 큰 우주 공간을 표현하기 위해 큰 단위를 사용한다.
- 렌더링 좌표는 `renderScale`로 축소해 Three.js 씬에 적용한다.
- 이 결정으로 큰 월드 스케일과 브라우저 렌더링 안정성을 동시에 확보한다.

### 5.3 청크 중심 가시 범위 렌더링

- 전체 월드를 한 번에 렌더링하지 않고 플레이어 주변 청크만 렌더링한다.
- 현재 반경은 2청크이며, 최대 125개 청크가 후보가 된다.
- 자원/건물 mesh 생성은 프레임별 queue로 분산하고, visible chunk 변경은 diff 기반 추가/제거로 처리한다.
- 배경, 별, 플레이어 함선, sector/chunk bounds는 기본 화면 맥락을 위해 먼저 준비하고, 상대적으로 무거운 자원/건물 mesh 생성만 뒤로 미룬다.
- 이는 WebGL 레이어나 별도 렌더 pass로 표시 순서를 강제하는 결정이 아니라, 초기 프레임과 chunk 전환 시점의 작업 부하를 분산하는 결정이다.
- 이는 Kickoff의 청크 기반 좌표공간 방향성과 일치한다.

### 5.4 자동항법을 상태 기계로 구현

- 자동항법은 단순 직선 이동 명령이 아니라 정지, 정렬, 가속, 순항, 감속 단계로 분리된다.
- 이 구조는 UI 피드백, 수동 취소, 로그 복원, 추후 명령 큐 확장에 유리하다.

### 5.5 항법 로그를 시간 기반으로 기록

- 항법 시작 시 로그를 생성하고, 실제 비행 시작 시 출발점/시각/최고속도/예상 비행 시간을 갱신한다.
- 재접속 시 로그의 `flight_start_at`과 현재 시각 차이로 위치와 속도를 재계산한다.
- 결정론적 이벤트 복원의 초기 형태로 볼 수 있다.

### 5.6 PC와 모바일을 하나의 입력 추상화로 통합

- 키보드 입력과 터치 D-pad는 모두 내부 액션 이름으로 변환된다.
- `activeActions`와 `getControlActionAmount()`가 입력 통합 지점이다.
- 특정 디바이스를 별도 타깃팅하기보다 pointer/touch/keyboard를 같은 조작 모델에 연결한다.

### 5.7 리소스 로딩을 명시적 시작 입력 뒤에 배치

- 브라우저 오디오 정책과 UX를 고려해 사용자의 최초 입력 이후 리소스 로딩과 오디오 준비를 수행한다.
- BGM 재생 역시 Start 이후 실행된다.

## 6. Kickoff 기준 반영 상태

### 6.1 PC-Mobile 멀티플랫폼

- 반영됨.
- UI는 `vh`, `dvh`, `clamp()` 기반 크기와 pointer/touch 입력을 사용한다.
- 키보드, 마우스, 터치 D-pad, pinch zoom이 함께 구현되어 있다.

### 6.2 살아있는 세상

- 일부 기반만 반영됨.
- 자원에는 `spawn_time`, `current_amount`, `base_yield_per_sec`가 존재하지만, 현재 코드에는 시간 경과에 따른 자원 자동 생성/소멸 사이클이나 채굴/소비 루프가 구현되어 있지 않다.
- 플레이어 접속과 무관한 시간 기반 변화는 현재 자동항법/함선 이동 복원에 먼저 적용되어 있다.

### 6.3 결정론적 시스템

- 일부 반영됨.
- 월드 생성은 seed 기반 난수로 구성되어 있으며, 생성된 seed가 저장된다.
- 로컬 IndexedDB가 권위 저장소 역할을 한다.
- 항법 이벤트는 로그로 저장된다.
- 단, 모든 액션이 집계되는 수준은 아직 아니며, 수동 조작 전체 이벤트 로그나 명령 큐는 구현되어 있지 않다.

### 6.4 청크 기반 좌표공간

- 반영됨.
- 1000개 청크를 생성하고, 플레이어 위치 주변 청크만 렌더링한다.
- 섹터와 오브젝트는 청크 ID와 로컬 위치를 가진다.
- 원거리 오브젝트를 단순 사각형 mesh로 표현하는 Diegetic LoD는 아직 별도 시스템으로 구현되어 있지 않다.

## 7. 현재 데이터 모델 요약

### 7.1 Sector

- 주요 필드: `sector_id`, `name`, `theme`, `theme_music_id`, `grid_size`, `chunk_id`, `chunk`, `resource_weights`, `global_bounds`, `chunk_bounds`, `created_at`
- 현재 섹터는 청크 하나의 전체 bounds를 점유한다.

### 7.2 Chunk

- 주요 필드: `chunk_id`, `position`, `global_bounds`, `sector_id`, `object_counts`, `created_at`
- `chunk_id` 형식은 `x:y:z`이다.

### 7.3 ResourceNode

- 주요 필드: `resource_instance_id`, `type`, `model_id`, `sector_id`, `chunk_id`, `chunk`, `position`, `local_position`, `total_capacity`, `current_amount`, `base_yield_per_sec`, `spawn_time`, `created_at`

### 7.4 Building

- 주요 필드: `building_instance_id`, `building_id`, `model_id`, `sector_id`, `chunk_id`, `chunk`, `position`, `local_position`, `hp`, `status`, `created_at`

### 7.5 PlayerShip

- 저장 위치: `meta/playerShip`
- 주요 필드: `ship_id`, `player_id`, `position`, `rotation`, `chunk_id`, `chunk`, `sector_id`, `speed`, `desiredSpeed`, `created_at`, `updated_at`

### 7.6 NavLog

- 저장 위치: `navLogs`
- 타입: `"standard"` (자동항해) | `"glide"` (감속 항해) | `"deactivation"` (비활성화 항해)
- 주요 필드: `id`, `type`, `issued_at`, `from_position`, `target`, `flight_start_at`, `peak_speed`, `desired_speed`, `coast_duration`, `flight_duration`, `status`, `completed_at`, `cancelled_at`
- 상세 스키마 및 타입별 규격: `PBDD/PBDD_Navigation.md` 참조

## 8. 현재 제약 및 후속 기획 후보

- 자원 채굴, 생산, 소비, 고갈, 재생성 루프는 아직 구현되어 있지 않다.
- 모든 플레이어 액션을 로그화하는 결정론적 명령 시스템은 아직 구현되어 있지 않다.
- 멀티플레이어 동기화 계층은 아직 없다.
- 섹터는 현재 하나의 청크에 매핑되며, 다중 청크 섹터나 계층형 공간 구조는 아직 없다.
- Diegetic LoD는 Kickoff에 명시되어 있으나 현재 코드에는 청크 bounds와 실제 모델 렌더링만 존재한다.
- 충돌 판정, 오브젝트 상호작용, 전투, 건설, 인벤토리, 경제 시스템은 아직 구현 범위 밖이다.
- 테스트 자동화는 `package.json` 기준 Playwright 의존성만 존재하며, 명시적 테스트 스크립트는 없다.

## 9. 후속 문서화 필요 항목

규모가 커질 경우 다음 항목은 `DesignDocuments/PBDD/PBDD_{name}.md` 형식의 별도 문서로 분리할 수 있다.

- `PBDD_WorldData.md`: 월드/청크/섹터/자원 데이터 모델
- `PBDD_WorldObjectRenderOptimization.md`: 월드 오브젝트 렌더 큐와 visible chunk diff 최적화
- `PBDD_Navigation.md`: 자동항법, 비활성화 항법, 결정론적 복원, 항법 로그 ✅ 작성 완료
- `PBDD_InputCamera.md`: PC/모바일 입력과 카메라 모드
- `PBDD_UI.md`: HUD, 시작 화면, 설정, 스캐너 UI
- `PBDD_AudioResource.md`: 리소스 로딩과 사운드 정책
