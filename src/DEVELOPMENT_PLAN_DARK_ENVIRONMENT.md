# Dark Environment Introduction Plan

## Purpose

`MTL-viewer.html`에서 검증한 우주 환경 표현을 메인 코드에 안전하게 이식한다. 첫 단계의 목표는 함선 효과를 제외한 환경 요소만 도입하는 것이다. 기존 메인 코드의 기본 밝은 환경은 보존하고, 테스트 환경의 어두운 우주 프리셋은 환경설정의 다크모드에서만 적용한다.

시각적 목표는 테스트 환경의 색감과 밀도를 충실히 반영하는 것이다. 단, 이번 단계에서는 성능 하락이 없어야 하므로 postprocessing 렌더 파이프라인, bloom composer, 별 bloom/occlusion pass 같은 추가 렌더 패스는 도입하지 않는다. 먼저 설정값과 데이터 구조만 이식한다.

## Scope

적용 대상:

- 메인 우주 환경의 background, fog, world light, renderer exposure 설정
- 기존 star field 생성 수치의 데이터화
- 우주맵 bounds 라인 색상과 opacity 설정
- 타깃 프레임 색상 설정
- 환경 프리셋 정의 구조
- 환경설정 UI에서 라이트/다크 모드 전환
- 환경 모드의 IndexedDB 저장 및 초기 로드

적용 제외:

- 함선 발광, 하이라이트, 엔진 출력, point light, billboard glow
- `EffectComposer`, `UnrealBloomPass`, selective bloom, star bloom render target
- star occlusion mask
- 색상이나 밀도에 대한 임의 보정
- UI 전체 테마 색상 변경
- 월드 오브젝트, 타겟 마커, HUD의 스타일 변경

범위가 불명확하거나, 위 적용 제외 항목을 건드려야 하는 상황이 발생하면 구현 전에 확인을 받는다.

## Current Main Environment

현재 메인 코드는 [js/GameManager.js](js/GameManager.js)의 단일 렌더 경로를 사용한다.

- 렌더링: `this.renderer.render(this.scene, this.camera)`
- postprocessing: 없음
- renderer:
  - `antialias: true`
  - `powerPreference: "high-performance"`
  - `preserveDrawingBuffer: true`
  - `toneMapping: ACESFilmicToneMapping`
  - `toneMappingExposure: 1.05`
  - pixel ratio cap: `Math.min(window.devicePixelRatio, 2)`
- scene:
  - background: `0xf3fbff`
  - fog: `FogExp2(0xe8f7ff, 0.000006)`
- world lights:
  - ambient: `0xf2fbff`, `0.9`
  - key directional: `0xffffff`, `6`, `[7, 8, 6]`
  - rim directional: `0x8fdcff`, `0.55`, `[-8, 4, -8]`
  - hemisphere: `0xf7fcff`, `0x8bb8c8`, `0.45`
- star field:
  - `createStars(1800, 8500, 32.8, 0.98)`
  - `createStars(900, 24000, 51.2, 0.74)`
  - `createStars(420, 52000, 73.6, 0.5)`
- world map bounds:
  - chunk bounds: `0xe7f2f9`, opacity `1`
  - sector bounds: sector별 색상, opacity `0.5`

현재 별 필드 수치 자체는 테스트 환경과 동일하다. 차이는 별 bloom/pass가 없고, 메인 환경의 배경/안개/조명이 밝은 프리셋이라는 점이다.

## MTL Viewer Environment

`MTL-viewer.html`의 환경 프리셋 `deep_blue_void` 기준:

- scene:
  - background: `0x030811`
  - fog: `FogExp2(0x05101b, 0.000004)`
  - RoomEnvironment PMREM blur: `0.04`
- renderer:
  - `toneMappingExposure: 0.82`
  - `preserveDrawingBuffer` 미사용
  - shadow map 비활성
- world lights:
  - ambient: `0x9fb9d8`, `0.28`
  - key directional: `0xd9f1ff`, `0.36`, `[7, 8, 6]`
  - rim directional: `0x5cc8ff`, `0.32`, `[-8, 4, -8]`
  - hemisphere: `0x93b6d5`, `0x08131c`, `0.18`
- star field:
  - 메인 코드와 동일한 count/radius/size/opacity
- star bloom:
  - 테스트 환경에는 존재하지만 이번 단계에서는 도입하지 않는다.

## Difference Summary

| Area | Main | Viewer | First Environment Step |
| --- | --- | --- | --- |
| Render path | direct render | composer + render targets | direct render 유지 |
| Object bloom | 없음 | selective bloom | 제외 |
| Star bloom | 없음 | render target + composite | 제외 |
| Star field base values | viewer와 동일 | 동일 | 데이터화만 수행 |
| Background/fog | light preset | dark preset | dark mode에서만 viewer 값 적용 |
| World lights | bright high intensity | dark low intensity | dark mode에서만 viewer 값 적용 |
| Renderer exposure | `1.05` | `0.82` | dark mode에서만 viewer 값 적용 |
| World map bounds | main only | 없음 | light/dark 프리셋에 기존 값을 명시 |
| Target frame | hardcoded blue | 없음 | light는 기존 blue, dark는 bright green |
| `preserveDrawingBuffer` | true | false | 이번 단계 변경 보류 |

`preserveDrawingBuffer` 제거는 성능 최적화 후보지만, 스크린샷/디버그/외부 캡처 의존성이 있는지 확인이 필요하다. 이번 단계는 “설정값만 도입”이므로 변경하지 않는다.

## Proposed Data Structure

새 환경 정의는 메인 코드에서 함선 정의와 분리한다.

후보 파일:

- `js/definitions/environmentDefinitions.js`

예상 구조:

```js
export const ENVIRONMENT_SETTINGS_KEY = "environmentSettings";

export const ENVIRONMENT_MODES = {
  light: "light",
  dark: "dark"
};

export const SPACE_ENVIRONMENT_PRESETS = {
  light: {
    id: "light",
    renderer: { toneMappingExposure: 1.05 },
    scene: {
      background: 0xf3fbff,
      fog: { type: "exp2", color: 0xe8f7ff, density: 0.000006 }
    },
    lights: {
      ambient: { color: 0xf2fbff, intensity: 0.9 },
      key: { color: 0xffffff, intensity: 6, position: [7, 8, 6] },
      rim: { color: 0x8fdcff, intensity: 0.55, position: [-8, 4, -8] },
      hemisphere: { skyColor: 0xf7fcff, groundColor: 0x8bb8c8, intensity: 0.45 }
    },
    worldMap: {
      bounds: {
        chunk: { color: 0xe7f2f9, opacity: 1 },
        sector: { opacity: 0.5, colors: {}, fallbackColor: 0xffffff }
      }
    },
    targeting: {
      frame: {
        outerColor: "#0000ff",
        outerOpacity: 0.15,
        innerColor: "#0000ff",
        innerOpacity: 0.45
      }
    },
    starField: {
      layers: [
        { count: 1800, radius: 8500, size: 32.8, opacity: 0.98 },
        { count: 900, radius: 24000, size: 51.2, opacity: 0.74 },
        { count: 420, radius: 52000, size: 73.6, opacity: 0.5 }
      ]
    }
  },
  dark: {
    id: "dark",
    renderer: { toneMappingExposure: 0.82 },
    scene: {
      background: 0x030811,
      fog: { type: "exp2", color: 0x05101b, density: 0.000004 }
    },
    lights: {
      ambient: { color: 0x9fb9d8, intensity: 0.28 },
      key: { color: 0xd9f1ff, intensity: 0.36, position: [7, 8, 6] },
      rim: { color: 0x5cc8ff, intensity: 0.32, position: [-8, 4, -8] },
      hemisphere: { skyColor: 0x93b6d5, groundColor: 0x08131c, intensity: 0.18 }
    },
    worldMap: {
      bounds: {
        chunk: { color: 0xe7f2f9, opacity: 1 },
        sector: { opacity: 0.5, colors: {}, fallbackColor: 0xffffff }
      }
    },
    targeting: {
      frame: {
        outerColor: "#ffffff",
        outerOpacity: 0.15,
        innerColor: "#00ff66",
        innerOpacity: 0.45
      }
    },
    starField: {
      layers: [
        { count: 1800, radius: 8500, size: 32.8, opacity: 0.98 },
        { count: 900, radius: 24000, size: 51.2, opacity: 0.74 },
        { count: 420, radius: 52000, size: 73.6, opacity: 0.5 }
      ]
    }
  }
};
```

초기 도입에서는 star field 값이 양쪽 동일하지만, 명시적으로 프리셋에 포함한다. 이후 다크모드에 한정된 추가 변경이 필요할 때 light 프리셋 보존을 강제하기 위함이다.

## Integration Plan

1. 환경 정의 파일 추가
   - 현재 메인 수치를 `light` 프리셋으로 그대로 옮긴다.
   - `MTL-viewer.html`의 dark 환경 수치를 `dark` 프리셋으로 옮긴다.
   - bloom/pass 관련 값은 정의에 넣지 않거나 `future` 주석 없이 제외한다.

2. `GameManager` 환경 상태 추가
   - `this.environmentMode` 기본값은 `"light"`.
   - IndexedDB 초기화 후 `settings` 스토어의 `environmentSettings` 값을 읽는다.
   - 허용값은 `"light" | "dark"`만 인정한다.
   - 저장 실패 시 기존 패턴처럼 toast를 띄운다.

3. 환경 적용 함수 분리
   - `applyEnvironmentPreset(mode)` 또는 `applyEnvironmentPreset(preset)` 추가.
   - 적용 대상:
     - `renderer.toneMappingExposure`
     - `scene.background`
     - `scene.fog`
     - world lights color/intensity/position
   - 기존 `setupWorld()`에서 직접 생성하던 world light를 `this.worldLights`로 보관한다.
   - 전환 시 기존 light 객체를 재생성하지 않고 값만 갱신한다.
   - `WorldMapManager`에는 환경별 `worldMap.bounds` 값을 전달하고, 기존 bounds line material만 갱신한다.
   - `TargetingOverlay`에는 환경별 `targeting.frame` 값을 전달하고, 프레임 색상만 갱신한다.

4. star field 생성 데이터화
   - `setupWorld()`의 하드코딩된 `createStars(...)` 호출을 프리셋의 `starField.layers` 기반으로 교체한다.
   - 현재 light/dark 값이 동일하므로 전환 시 별 geometry 재생성은 하지 않는다.
   - 이후 dark 전용 star 값 변경이 필요해질 때는 별도 확인 후 재생성/업데이트 전략을 결정한다.

5. 환경설정 UI 추가
   - Settings > Data 또는 별도 환경 섹션에 `Environment` segmented control 추가.
   - 버튼: `Light`, `Dark`.
   - UI 텍스트 추가는 필요한 최소 범위로 제한한다.
   - 전체 UI 테마 색상은 바꾸지 않는다.

6. 설정 저장
   - 저장 위치는 IndexedDB `settings` 스토어로 한다.
   - key: `environmentSettings`
   - record shape: `{ key: "environmentSettings", mode: "light" | "dark" }`
   - DB 초기화 전 설정 UI에서 변경된 값은 메모리에 먼저 적용하고, DB 초기화 후 저장한다.

7. 런타임 전환
   - 설정 변경 즉시 `GameManager.setEnvironmentMode(mode)` 호출.
   - 즉시 scene/renderer/world light 값을 갱신한다.
   - 렌더 파이프라인은 direct render 그대로 유지한다.

8. 검증
   - light 기본값이 변경 전과 동일한지 코드 값 비교.
   - dark 전환 후 background/fog/lights/exposure가 viewer 값과 일치하는지 확인.
   - IndexedDB 저장/재로드 복원 확인.
   - Playwright screenshot으로 light/dark 각각 캔버스가 nonblank인지 확인.
   - FPS 또는 프레임 시간에 의미 있는 하락이 없는지 `DevFps` 또는 브라우저 성능 로그로 확인.

## Performance Policy

이번 단계에서 허용되는 성능 관련 변경:

- 하드코딩 수치를 정의 데이터로 옮기는 것
- 기존 light 객체를 보관하고 값만 갱신하는 것
- 별 필드 생성 수치를 데이터 기반으로 읽는 것
- 이미 존재하는 direct render 루프 유지

이번 단계에서 허용되지 않는 성능 관련 변경:

- 렌더 패스 추가
- render target 추가
- composer 도입
- star bloom/occlusion 도입
- 매 프레임 scene traversal 추가
- 별 geometry 재생성
- shadow map 활성화

검토 후보이나 이번 단계에서 보류:

- `preserveDrawingBuffer: true` 제거
  - 테스트 환경에서는 제거되어 성능상 유리하다.
  - 메인 코드에서 캡처, 디버그, 외부 도구 의존성이 있는지 먼저 확인해야 한다.

## Risks

- 다크 환경의 낮은 조명 강도가 기존 월드 오브젝트/함선 가시성을 과하게 낮출 수 있다.
  - 이번 단계는 “viewer 값 충실 적용”을 우선하며, 임의 보정하지 않는다.
  - 가시성 문제가 확인되면 별도 승인 후 다크 프리셋 수정을 검토한다.

- 설정 UI 추가가 시각 스타일 변경으로 번질 수 있다.
  - 기존 settings panel의 segmented control 스타일만 재사용한다.
  - 새로운 장식, 배경, 색상 체계 변경은 하지 않는다.

- IndexedDB 초기화 전 설정 UI에서 환경 모드를 바꿀 수 있다.
  - 이 경우 런타임에는 즉시 적용하고, DB 초기화 후 `settings` 스토어에 저장한다.

## Confirmation Points

구현 중 다음 상황이 생기면 즉시 확인받는다.

- 다크모드 적용 후 함선 또는 월드 오브젝트가 너무 어두워 수치 보정이 필요해 보이는 경우
- `preserveDrawingBuffer` 제거가 필요하다고 판단되는 경우
- 별 필드 수치를 dark 전용으로 바꾸고 싶어지는 경우
- 월드맵 bounds 색상을 dark 전용으로 새로 보정해야 한다고 판단되는 경우
- UI 탭 추가, 설정 패널 레이아웃 변경 등 단순 control 추가를 넘어서는 변경이 필요한 경우
- postprocessing 없이는 목표 시각에 도달하기 어렵다고 판단되는 경우

## First Implementation Checklist

- [x] `js/definitions/environmentDefinitions.js` 추가
- [x] `GameManager`에 `environmentMode`, `worldLights`, 환경 로드/저장/적용 메서드 추가
- [x] `setupRenderer`, `setupScene`, `setupWorld`가 프리셋을 소비하도록 변경
- [x] `WorldMapManager`가 환경별 bounds 색상/opacity를 소비하도록 변경
- [x] `TargetingOverlay`가 환경별 target frame 색상을 소비하도록 변경
- [x] `UIManager.bindControls`에 환경 모드 변경 콜백 추가
- [x] `UIManager`에 환경 모드 segmented control 상태 동기화 추가
- [x] `index.html` settings data panel에 Environment control 추가
- [x] light 모드 기본값 회귀 검증
- [x] dark 모드 viewer 수치 일치 검증
- [x] IndexedDB 재로드 복원 검증
- [x] screenshot/FPS 검증
