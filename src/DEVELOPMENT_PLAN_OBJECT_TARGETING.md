# Object Targeting Selection System Development Plan

## 1. Purpose

이 문서는 `sample-targeting_effect.html`의 타겟팅 연출을 현재 Void Zero 3D 앱에 이식하기 위한 작업 계획서다.

이번 작업의 핵심 목표는 다음과 같다.

- 월드 오브젝트를 클릭 또는 터치로 선택한다.
- 선택 프레임은 실제 오브젝트 크기와 카메라 거리 기준으로 계산한다.
- 선택 프레임의 코너 효과, 선 두께, gap, 아이콘 크기는 절대 규격을 유지한다.
- 동적으로 변하는 것은 선택박스의 전체 위치와 크기뿐이다.
- 선택 시 화면 우측 상단에 선택 요소 이름만 표시한다.
- 선택 해제는 우측 상단 이름 박스의 닫기 버튼으로만 가능하다.
- 청크 가시성 변경으로 대상 모델이 렌더링되지 않아도 선택 상태와 프레임은 유지한다.

## 2. Current State

현재 앱 구조는 다음과 같다.

- `GameManager.js`
  - Three.js scene, camera, renderer, pointer input, camera control을 관리한다.
  - pointer 이벤트는 현재 카메라 드래그, 핀치 줌, 터치 D-pad에 사용된다.
- `WorldMapManager.js`
  - `objectsGroup` 아래에 resource/building 오브젝트를 생성한다.
  - 각 오브젝트 root에는 `userData.kind`, `userData.id`, `userData.absolute_position` 등이 들어 있다.
  - 청크 가시성 변경 시 `objectsGroup`이 다시 구성될 수 있다.
- `UIManager.js`
  - DOM 기반 HUD와 팝업 UI를 관리한다.
- `index.html`
  - WebGL canvas 위에 `.hud` DOM 레이어가 있다.

## 3. Sample Code Requirements

`sample-targeting_effect.html`에서 반드시 보존해야 할 개념은 다음이다.

### 3.0 Source Code Fidelity Rule

샘플의 타게팅 규격과 애니메이션은 말로 재해석하지 않는다. 구현 전 `sample-targeting_effect.html`에서 아래 코드 단위를 그대로 대조하고, 변경이 필요한 지점은 계획서 승인 단계에서 명시적으로 결정한다.

필수 대조 대상:

```js
const LOCK_INTRO_DURATION = 820;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function saturate(v) { return clamp(v, 0, 1); }
function smoothstep(edge0, edge1, x) {
  const t = saturate((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
}
function easeOutCubic(t) {
  t = saturate(t);
  return 1 - Math.pow(1 - t, 3);
}
```

```js
function getSelectionFrameMetrics() {
  const vh = H * 0.01;
  const unit = clamp(vh, 7, 11);
  const hoverCorner = unit * 2.0;
  const hoverOffset = unit * 0.72;
  const doubleGap = 6;
  const doubleOuterCorner = hoverCorner * 0.92;
  const doubleInnerCorner = hoverCorner * 0.82;
  const cornerReach = Math.max(doubleOuterCorner, doubleGap + doubleInnerCorner);
  const minSelectionSide = Math.ceil((hoverOffset + cornerReach) * 2 + unit * 1.35);

  return {
    hoverCorner,
    hoverOffset,
    hoverLineWidth: clamp(unit * 0.13, 1, 1.45),
    doubleOuterCorner,
    doubleInnerCorner,
    doubleGap,
    introGap: 10,
    minSelectionSide,
    introFrameOutset: unit * 3.25,
    connectorDrop: unit * 2.0,
    frameAlpha: 0.24,
    frameAlphaSoft: 0.16
  };
}
```

```js
function getLockFrameIntro(elapsed, metrics) {
  const p = saturate(elapsed / LOCK_INTRO_DURATION);
  const segment1End = 0.42;
  const settle = easeOutCubic((p - segment1End) / (1 - segment1End));
  const blinkA = smoothPulse(p, 0.04, 0.15);
  const blinkB = smoothPulse(p, 0.23, 0.34);
  const settleAlpha = smoothstep(0.39, 0.56, p);
  const alpha = Math.max(blinkA, blinkB, settleAlpha);
  const gap = lerp(metrics.introGap, metrics.doubleGap, settle);
  const frameOutset = lerp(metrics.introFrameOutset, 0, settle);

  return { alpha, gap, frameOutset };
}
```

구현 원칙:

- 위 함수의 수치와 easing 구간은 임의로 CSS animation이나 다른 duration으로 치환하지 않는다.
- `TargetingOverlay.js`를 만들 경우 위 함수들을 거의 그대로 옮기고, 앱 좌표계와 canvas 크기만 adapter로 연결한다.
- 변경이 필요한 경우에는 "샘플과 다른 점" 목록에 한 줄씩 남기고 승인받는다.
- 현재 승인 후보 차이: `getSelectionFrameMetrics()`의 비율 계산은 유지하되, 최종 metric 값은 `snap(value, step)`으로 정규화한다.

### 3.1 Animation Timing

샘플의 선택 프레임 intro 흐름을 충실히 따른다.

- `LOCK_INTRO_DURATION = 820`
- `getLockFrameIntro(elapsed, metrics)`
- `smoothPulse(t, start, end)`
- `smoothstep(edge0, edge1, x)`
- `easeOutCubic(t)`

샘플 intro의 핵심 동작:

- 초반 두 번의 blink pulse
- 이후 settle alpha로 고정
- `frameOutset`이 바깥에서 최종 프레임 위치로 수렴
- double corner 내부 gap이 `10`에서 `metrics.doubleGap`으로 수렴

### 3.2 Frame Metrics

샘플의 `getSelectionFrameMetrics()` 개념을 유지한다.

- 샘플은 화면 높이 `H * 0.01`에서 시작한 뒤 `clamp(vh, 7, 11)`로 unit을 제한한다.
- production에서도 샘플의 비율 계산은 유지한다.
- 다만 `11.2px`, `1.37px`처럼 미묘한 소수점 metric이 생기는 것을 줄이기 위해 최종 metric 값을 스냅한다.
- 코너 길이, offset, double gap, intro outset은 선택박스 크기가 아니라 스냅된 metric unit에서 나온다.
- 선 두께는 코너 위치/길이와 별도 step으로 스냅할 수 있다.
- 따라서 오브젝트가 커져도 코너 장식 자체가 같이 커지면 안 된다.

코드 레벨 규격 검토 항목:

```js
function snap(value, step = 1) {
  return Math.round(value / step) * step;
}

const rawUnit = clamp(height * 0.01, 7, 11);
const unit = snap(rawUnit, 1);
const hoverLineWidth = snap(clamp(unit * 0.13, 1, 1.45), 0.5);
const margin = snap(clamp(projectedRadius * 0.18, 16, 34), 1);
```

샘플과 다른 점:

- 샘플: `unit = clamp(H * 0.01, 7, 11)`
- production 권장안: `unit = snap(clamp(H * 0.01, 7, 11), 1)`

이 차이는 의도적이다. 샘플의 애니메이션 구조와 코너 비율은 유지하되, 해상도와 계산 결과에 따른 미세한 소수점 흔들림을 줄이기 위해 최종 metric을 정규화한다.

렌더링 기준:

- 모든 타게팅 장식 규격은 canvas CSS pixel 좌표계 기준으로 계산한다.
- DPR은 canvas 선명도를 위한 backing store scaling에만 사용한다.
- DPR 값으로 코너 길이, icon 크기, line width의 CSS pixel 규격을 다시 키우지 않는다.
- metric 스냅은 resize 또는 metric recompute 시점에 수행한다.
- 스냅 연산은 `Math.round` 기반이므로 렌더링 비용은 무시 가능하다.

기본 스냅 후보:

- frame side, corner length, offset, margin: `1px`
- icon box, icon size: `1px` 또는 `2px`
- line width: `0.5px`

### 3.3 Drawing Model

샘플은 canvas 2D drawing으로 동작한다. 현재 앱에서도 샘플 충실도를 위해 DOM/CSS 애니메이션만으로 흉내내지 않는다.

권장 구현:

- WebGL canvas 위에 별도 `targetingCanvas`를 fixed overlay로 추가한다.
- `pointer-events: none`으로 두어 게임 입력을 막지 않는다.
- 매 프레임 2D canvas context로 선택 프레임과 아이콘을 그린다.
- 우측 상단 이름 박스와 닫기 버튼은 DOM으로 둔다.

## 4. Selection Box Calculation

선택박스는 실제 오브젝트 크기를 기준으로 계산한다.

중요 규칙:

- 타게팅 프레임에는 최소 규격이 존재한다.
- 타게팅 프레임에는 샘플과 동일한 최대 규격이 존재한다.
- 먼 거리의 오브젝트는 최소 규격으로 보일 수 있어야 한다.
- 가까이 있거나 거대한 오브젝트는 샘플과 동일하게 viewport 기준 92% 상한으로 제한한다.

샘플 코드 검토 메모:

현재 `sample-targeting_effect.html`에는 다음 코드가 존재한다.

```js
const rawSide = projectedRadius * 2 + margin * 2;
const maxSelectionSide = Math.max(metrics.minSelectionSide, Math.max(W, H) * 0.92);
const side = clamp(rawSide, metrics.minSelectionSide, maxSelectionSide);
```

최신 결정: 이 최대 상한은 유지한다. 선택 프레임은 최소 규격과 최대 규격을 모두 샘플 코드와 동일하게 따른다.

### 4.1 Visible Object Case

대상 모델이 현재 `objectsGroup`에 존재할 때:

1. `THREE.Box3().setFromObject(object)`로 실제 world bounds를 구한다.
2. `box.getCenter(center)`로 중심점을 구한다.
3. `box.getSize(size)`로 크기를 구한다.
4. `radius = size.length() / 2`를 계산한다.
5. 중심점을 camera space 또는 NDC로 투영한다.
6. 샘플의 `calculateSquareFrame()`과 같은 방식으로 화면상 사각 프레임을 계산한다.

프레임 크기 계산 원칙:

```js
nearestDepth = max(centerDepth - radius, camera.near);
projectedRadius = radius / nearestDepth * focal;
margin = clamp(projectedRadius * 0.18, 16, 34);
rawSide = projectedRadius * 2 + margin * 2;
maxSelectionSide = Math.max(metrics.minSelectionSide, Math.max(width, height) * 0.92);
side = clamp(rawSide, metrics.minSelectionSide, maxSelectionSide);
```

이 방식은 단순히 8개 꼭짓점의 screen bounds를 감싸는 방식보다 샘플에 가깝다. 최소/최대 규격 모두 샘플과 동일하게 적용한다.

### 4.2 Invisible Object Case

청크 가시성 변경으로 모델이 사라진 경우:

선택 시점에 저장한 값을 사용할 수 있다.

- `id`
- `kind`
- `type`
- `name`
- `worldCenter`
- `boundingRadius`
- `iconSource` 또는 `iconClass`

다만 "렌더링되지 않거나 매우 멀리 존재하는 오브젝트"는 항상 실제 크기 계산이 필요한지 검토한다.

검토 옵션:

- Option A: 선택 시점 또는 데이터 정의에서 가능한 radius를 저장하고, invisible 상태에서도 실제 추정 크기로 표시한다.
- Option B: invisible/remote 상태에서는 `metrics.minSelectionSide`를 기준으로 최소 프레임만 표시하고, 모델이 렌더링되는 순간 실제 크기로 자연스럽게 전환한다.

현재 권장안은 Option B다.

이유:

- 렌더링되지 않는 대상은 실제 `Box3`를 계산할 수 없다.
- definition의 `visual.scale`만으로 정확한 mesh bounds를 추정하면 모델별 오차가 생긴다.
- 먼 대상은 사용자가 큰 프레임보다 "선택 유지 여부와 방향성"을 확인하는 것이 우선이다.
- 실제 모델이 렌더링되는 시점에 `Box3` 기반 규격으로 전환하면 정확도를 회복할 수 있다.

Option B 구현 방식:

1. invisible/remote 상태에서는 저장된 `worldCenter`만 투영한다.
2. frame side는 `metrics.minSelectionSide`로 둔다.
3. 대상 모델이 다시 렌더링되어 `Box3`가 계산되면 `actualSide`를 계산한다.
4. `displaySide = lerp(previousDisplaySide, actualSide, transition)` 방식으로 최소 크기에서 실제 크기로 자연스럽게 변화시킨다.
5. 이 전환은 선택 intro animation과 별개로, 규격 변경 smoothing으로만 처리한다.

이 상태는 "타게팅은 유지되지만 대상 모델링은 렌더링되지 않는 상태"로 본다.

### 4.3 Reappearing Object Case

선택된 오브젝트가 다시 가시 청크에 들어와 `objectsGroup`에 생성되면:

- 같은 `kind + id`를 찾아 실제 object 참조를 다시 연결한다.
- 이후 프레임은 다시 `Box3().setFromObject(object)` 기준으로 계산한다.
- invisible 최소 프레임에서 실제 프레임으로 갑자기 튀지 않도록 side/center를 짧은 시간 보간한다.

## 5. Input Rules

### 5.1 Selection

- mouse left click 또는 touch tap으로 선택한다.
- `THREE.Raycaster`를 기본 선택 판정으로 사용한다.
- 하위 mesh가 hit되어도 부모를 타고 올라가 `userData.kind`가 있는 root object를 찾는다.
- 이미 선택 중이어도 다른 오브젝트 클릭/터치는 즉시 선택 교체한다.

### 5.2 Non-selection Gestures

다음 입력은 선택으로 판정하지 않는다.

- camera drag
- pinch zoom
- touch D-pad 이동
- 일정 threshold 이상 pointer movement
- UI 버튼 클릭

### 5.3 Deselection

선택 해제는 오직 우측 상단 이름 박스의 닫기 버튼으로만 수행한다.

다음 상황에서는 선택 해제하지 않는다.

- 빈 공간 클릭
- ESC 입력
- 카메라 전환
- 카메라 이동
- 화면 이동 입력
- 청크 가시성 변경
- 대상 모델이 현재 렌더링되지 않음

## 6. HUD Rendering Plan

### 6.1 Targeting Canvas

`index.html`의 `.hud` 내부 또는 `body`에 다음 canvas를 추가한다.

```html
<canvas id="targetingCanvas" class="targeting-canvas" aria-hidden="true"></canvas>
```

CSS:

- `position: fixed`
- `inset: 0`
- `width: 100vw`
- `height: 100vh`
- `pointer-events: none`
- WebGL canvas보다 위, DOM controls보다 아래 또는 같은 HUD layer

### 6.2 Drawing Responsibilities

`GameManager` 또는 별도 helper class가 다음을 담당한다.

- canvas resize와 DPR scaling
- frame metrics 계산
- selected object frame 계산
- sample intro animation drawing
- object type icon drawing

### 6.3 Name Panel

이름 패널은 DOM으로 구성한다.

요구사항:

- 화면 우측 상단
- 선택 요소 이름만 표시
- 닫기 버튼 포함
- 닫기 버튼은 pointer event 가능
- 이름 패널 외 다른 선택 UI는 pointer event를 받지 않음

## 7. Icon Rules

아이콘은 선택박스 바깥 좌측 상단에 표시한다.

규격:

- 아이콘 박스 크기 고정
- SVG 크기 고정
- 선택박스 크기에 따라 scale되지 않음
- 위치만 선택박스의 최종 `frameMinX/frameMinY`에 따라 이동

아이콘 선택 기준 초안:

- resource: resource/icon group
- building:
  - `size === "EX"`: `ind_ex.svg`
  - `size === "L"`: `ind_large.svg`
  - `size === "M"`: `ind_medium.svg`
  - `size === "S"`: `ind_small.svg`

실제 SVG 경로는 현재 repo의 `rss/svg/ind_*.svg` 상태를 기준으로 확정한다.

## 8. Code Touch Points

예상 수정 파일:

- `index.html`
  - targeting canvas 추가
  - selection name panel 추가
  - 관련 CSS 추가
- `js/UIManager.js`
  - name panel element 참조
  - selected name 표시/숨김
  - 닫기 버튼 callback 연결
- `js/GameManager.js`
  - selection state 추가
  - raycaster 추가
  - pointer tap 판정 추가
  - object bounds/radius 계산
  - targeting canvas drawing loop 호출
  - 청크 밖 fallback target 유지

선택적으로 새 파일 분리:

- `js/TargetingOverlay.js`
  - canvas rendering, metrics, sample animation 이식 전담

권장: `TargetingOverlay.js`로 분리한다. `GameManager.js`가 이미 크므로, 샘플 기반 drawing 로직은 별도 클래스로 두는 편이 검토와 유지보수에 유리하다.

## 9. Implementation Steps

0. 샘플 코드 대조표 작성
   - `getSelectionFrameMetrics()`
   - `calculateSquareFrame()`
   - `getLockFrameIntro()`
   - `drawAnimatedDoubleCornerGroup()`
   - `drawCorner()`
   - 샘플과 production 구현의 차이를 diff 형태로 기록

1. `TargetingOverlay.js` 생성
   - resize
   - clear
   - metrics
   - frame drawing
   - icon drawing
   - sample intro functions

2. `index.html`에 overlay canvas와 name panel 추가

3. `UIManager.js`에 name panel 제어 추가
   - `setSelectedObjectName(name)`
   - `clearSelectedObjectName()`
   - `bindControls({ onClearWorldSelection })`

4. `GameManager.js`에 selection state 추가
   - selected id/kind/type/name
   - object ref
   - saved center/radius
   - lockFrameStartedAt

5. Raycaster 기반 click/touch selection 추가
   - drag/pinch/D-pad와 구분

6. 매 프레임 overlay 갱신
   - visible object면 Box3 기준
   - invisible/remote object면 saved center + minimum side 기준
   - reappearing object면 minimum side에서 actual side로 smoothing

7. 닫기 버튼 selection clear 연결

8. 검증 및 조정

## 10. Verification Checklist

기능 검증:

- 오브젝트 클릭 선택
- 오브젝트 터치 선택
- 다른 오브젝트 선택 교체
- 빈 공간 클릭 시 선택 유지
- ESC 입력 시 선택 유지
- 카메라 이동/회전/줌 중 선택 유지
- 닫기 버튼으로만 선택 해제
- 청크 밖으로 대상 모델이 사라져도 프레임 유지
- 다시 청크 안으로 들어오면 실제 모델 크기 기준으로 재계산

시각 검증:

- 샘플 코드와 production code의 timing/metric 수치가 일치하는지 확인
- production의 타게팅 장식 metric이 `snap(value, step)` 규칙으로 정규화되는지 확인
- DPR 변화가 canvas 선명도에만 영향을 주고 장식의 canvas CSS pixel 규격을 바꾸지 않는지 확인
- intro animation이 샘플 timing과 유사한지 확인
- blink pulse가 2회 나타나는지 확인
- frame outset이 바깥에서 안쪽으로 수렴하는지 확인
- double corner gap이 수렴하는지 확인
- 코너 길이/선 두께/icon 크기가 오브젝트 크기와 무관하게 일정한지 확인
- 선택박스 전체 크기만 오브젝트 크기/거리 기준으로 변화하는지 확인
- 매우 큰/가까운 대상에 샘플과 동일한 92% 최대 크기 clamp가 적용되는지 확인
- 매우 먼 대상이 최소 규격으로 유지되는지 확인
- invisible target이 최소 규격으로 표시되다가 실제 모델 렌더링 시 자연스럽게 실제 규격으로 전환되는지 확인

기술 검증:

- `node --check js/GameManager.js`
- `node --check js/UIManager.js`
- `node --check js/TargetingOverlay.js`
- Playwright로 콘솔 error 확인
- 데스크톱 viewport 확인
- 모바일 viewport 확인

## 11. Risks and Decisions

### 11.0 Sample Code Clamp Audit

현재 샘플 코드는 `calculateSquareFrame()` 안에서 viewport 기준 최대 상한을 둔다.

유지 대상 코드:

```js
const maxSelectionSide = Math.max(metrics.minSelectionSide, Math.max(W, H) * 0.92);
const side = clamp(rawSide, metrics.minSelectionSide, maxSelectionSide);
```

최신 결정: production에서도 이 상한을 유지한다. 따라서 샘플과 production 사이에 이 부분의 의도적 차이를 두지 않는다.

### 11.0.1 Snapped Metric Unit

샘플의 `getSelectionFrameMetrics()`는 화면 높이에 따라 `unit`이 7-11 canvas CSS pixel 범위에서 바뀐다.

production에서는 샘플의 비율 계산을 유지하되, 최종 metric 값을 `snap(value, step)`으로 정규화한다.

결정 제안:

- animation timing, gap interpolation, frame outset 구조는 샘플을 따른다.
- metric unit은 `snap(clamp(H * 0.01, 7, 11), 1)`로 계산한다.
- line width는 `0.5px` step으로 별도 스냅한다.
- 스냅 연산은 resize 또는 metric recompute 시점에 수행하므로 성능 비용은 무시 가능하다.
- 선택박스 전체 위치와 크기만 오브젝트 크기/거리/카메라에 따라 변화한다.

### 11.1 DOM vs Canvas

샘플 충실도를 우선하면 canvas overlay가 맞다.

DOM/CSS로 구현하면 layout은 쉬우나, 샘플의 `drawLockFrame()` 흐름과 alpha/gap/outset animation을 그대로 검증하기 어렵다.

결정 제안: canvas overlay 사용.

### 11.2 Square Frame vs Projected Bounds

샘플은 오브젝트 회전으로 프레임이 흔들리지 않도록 bounding radius 기반 square frame을 사용한다.

현재 요구도 "오브젝트 크기를 계산하여 기준으로 박스"를 요구하므로, `Box3`에서 radius를 얻고 샘플 방식으로 square frame을 계산하는 것이 적합하다.

결정 제안: `Box3 -> radius -> sample calculateSquareFrame` 사용.

### 11.3 Invisible Target Frame

모델이 렌더링되지 않는 상태에서도 프레임을 유지하려면 선택 시 center 저장이 필수다.

크기 표현은 두 가지가 있다.

- 실제 추정 radius 저장
- 최소 규격으로 유지 후 실제 렌더링 시 전환

결정 제안: `savedCenter`는 반드시 저장하고, invisible/remote 상태는 최소 규격으로 표시한다. 모델이 렌더링되면 실제 `Box3` 기준 크기로 smoothing 전환한다.

## 12. Non-goals

이번 작업에서 하지 않는다.

- 상세 정보 패널 확장
- 선택 대상 자동 항법 연결
- 멀티 선택
- hover preview effect
- 대상 외곽선 shader/highlight
- 선택 상태 저장/로드

## 13. Approval Gate

이 문서는 구현 전 검토용이다.

진행 전 결정할 항목:

- canvas overlay 방식 승인 여부
- `TargetingOverlay.js` 신규 파일 분리 승인 여부
- 아이콘 매핑 기준 승인 여부
- square frame 산정 방식 승인 여부
- 샘플 코드의 최대 상한 clamp 유지 승인 여부
- production metric을 `snap(value, step)`으로 정규화할지
- 청크 밖 invisible target을 최소 규격으로 표시할지, 추정 radius로 표시할지
- invisible minimum frame에서 visible actual frame으로 전환할 때 smoothing을 적용할지

위 항목이 승인되면 구현을 시작한다.
