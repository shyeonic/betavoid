# I18n Foundation Plan

이 문서는 beta-void의 i18n 기반을 도입하기 위한 개발 계획서다. 이번 단계의 목표는 전체 번역을 완성하는 것이 아니라, 앞으로 UI와 정의 카탈로그가 안전하게 다국어화될 수 있는 구조를 먼저 만드는 것이다.

## 1. 목표

- 게임 규칙 ID와 표시 문자열을 분리한다.
- UI, toast, confirm, settings, scanner, key binding label을 번역 키 기반으로 전환할 수 있는 기반을 만든다.
- 아이템/자원/건물/섹터 정의의 표시명과 설명을 i18n catalog로 이동할 수 있게 한다.
- 저장 데이터에는 번역된 문자열이 아니라 안정적인 ID만 남기도록 방향을 정한다.
- 초기 지원 언어는 `ko`, `en`으로 둔다.

## 2. 현재 문자열 구조

현재 문자열은 크게 네 곳에 흩어져 있다.

- `index.html`: 버튼 텍스트, aria-label, title, settings label, start scene 문구
- `js/UIManager.js`: scanner, object detail, key binding, loading, toast 표시 문구
- `js/GameManager.js`: toast/error/confirm 메시지와 일부 상태 문구
- `js/definitions/*`: `name`, `name_en`, `description` 형태의 정의 표시 문자열

현재 구조는 표시 문자열이 코드와 데이터에 직접 섞여 있으므로, 언어 전환이나 누락 검증을 하려면 먼저 공통 i18n 접근 계층이 필요하다.

## 3. 설계 원칙

### 3.1 ID는 번역하지 않는다

다음 값은 저장 데이터와 게임 규칙의 안정적인 식별자이므로 번역하지 않는다.

- `item_001`
- `rss_001`
- `arc_station`
- `SEC-001`
- `bgm_sector_01`
- `trade_basic`
- `resource_id`, `building_id`, `sector_id`, `item_id`

### 3.2 표시명은 번역 키로 해결한다

전역 definition catalog의 `name`, `name_en`, `description` 같은 표시 문자열 필드는 최종적으로 번역 키 참조로 치환한다. 정의 데이터는 게임 규칙과 참조 관계를 담고, 실제 표시 문구는 locale catalog가 책임진다.

최종 목표 구조:

```js
{
  item_id: "item_001",
  label_key: "item.item_001.name",
  description_key: "item.item_001.description"
}
```

건물과 섹터도 같은 원칙을 따른다.

```js
{
  building_id: "arc_station",
  label_key: "building.arc_station.name",
  description_key: "building.arc_station.description"
}
```

```js
{
  sector_id: "SEC-001",
  label_key: "sector.SEC-001.name",
  theme_key: "sector.SEC-001.theme"
}
```

초기 전환 단계에서는 기존 `name`, `name_en`, `description`을 바로 제거하지 않고, i18n 키의 fallback 원본으로 사용한다. 이후 충분히 검증되면 표시 문자열을 locale catalog로 완전히 이동한다.

권장 전환 순서:

1. 모든 definition에 `label_key`, `description_key`, 필요 시 `theme_key`를 추가한다.
2. `ko/en` locale catalog에 기존 `name`, `name_en`, `description` 값을 옮긴다.
3. UI는 `name/name_en` 직접 참조 대신 i18n resolve helper를 사용한다.
4. 검증 스크립트가 모든 definition key의 locale 존재 여부를 확인한다.
5. 안정화 후 `name`, `name_en`, `description` 필드를 제거한다.

### 3.3 fallback은 명확해야 한다

번역 키 조회 순서:

1. 현재 locale
2. fallback locale `en`
3. 정의에 남아있는 legacy display field
4. key 자체 표시

개발 중에는 누락 키를 콘솔 경고 또는 검증 스크립트로 잡는다.

## 4. 목표 파일 구조

```txt
js/i18n/
  i18n.js
  localeRegistry.js
  locales/
    en.js
    ko.js
```

### 4.1 `i18n.js`

책임:

- 현재 locale 관리
- fallback locale 관리
- `t(key, params)` 제공
- `formatNumber`, `formatDateTime` 같은 Intl helper 제공
- `resolveDefinitionText(definition, field)` 제공

예상 API:

```js
const i18n = createI18n({
  locale: "ko",
  fallbackLocale: "en",
  messages
});

i18n.t("ui.start.button");
i18n.t("toast.navigation.engaged", { eta: "12s" });
i18n.resolveDefinitionText(itemDefinition, "name");
```

### 4.2 Locale Catalog

locale catalog는 중첩 객체 형태를 기본으로 한다.

```js
export const ko = {
  ui: {
    start: {
      button: "시작"
    }
  },
  item: {
    item_001: {
      name: "하이드라이트",
      description: "수소광물 자원"
    }
  }
};
```

## 5. 번역 키 네이밍 규칙

### 5.1 UI

- `ui.start.title`
- `ui.start.prompt`
- `ui.settings.title`
- `ui.settings.tabs.keys`
- `ui.settings.tabs.data`
- `ui.scanner.title`
- `ui.scanner.categories.resources`
- `ui.scanner.categories.buildings`
- `ui.scanner.empty`
- `ui.objectDetail.title`
- `ui.nav.on`
- `ui.nav.off`

### 5.2 Toast/Error/Confirm

- `toast.world.regenerated`
- `toast.world.reloaded`
- `toast.navigation.engaged`
- `error.world.databaseUnavailable`
- `error.bgm.unavailable`
- `confirm.world.regenerate`
- `confirm.data.clearAll`

### 5.3 Controls

- `control.group.flight`
- `control.action.pitchUp`
- `control.action.pitchDown`
- `control.action.cameraToggle`

### 5.4 Definitions

- `item.item_001.name`
- `item.item_001.description`
- `resource.rss_001.name`
- `building.arc_station.name`
- `building.arc_station.description`
- `sector.SEC-001.name`
- `sector.SEC-001.theme`

## 6. 단계별 작업 계획

### 6.1 1단계: I18n Core 추가

작업:

- `js/i18n/i18n.js` 추가
- `js/i18n/locales/ko.js`, `en.js` 추가
- `createI18n()` 구현
- `t()`, interpolation, fallback 처리 구현
- locale 선택 기본값 결정

기본 locale 결정:

1. `localStorage["beta-void-locale"]`
2. `navigator.language`
3. `en`

완료 기준:

- 브라우저 콘솔에서 `i18n.t()`가 동작한다.
- 없는 키는 fallback 처리된다.
- interpolation이 동작한다.

### 6.2 2단계: Static HTML 문자열 연결

작업:

- `index.html`의 정적 텍스트에 `data-i18n`, `data-i18n-attr`를 부여한다.
- 앱 초기화 시 DOM의 static i18n marker를 한 번 적용한다.
- aria-label, title도 번역 대상으로 포함한다.

완료 기준:

- start/settings/scanner의 정적 문구가 locale catalog에서 온다.
- 접근성 속성도 locale에 따라 바뀐다.

### 6.3 3단계: UIManager 문자열 전환

작업:

- `UIManager` 생성자에 `i18n` 의존성을 주입한다.
- scanner category, sort label, detail popup, loading detail, nav label, key binding label을 `i18n.t()`로 전환한다.
- hardcoded confirm/toast/error 문자열은 직접 표시하지 않고 key를 통해 표시한다.

완료 기준:

- `UIManager.js`의 주요 사용자 표시 문자열이 번역 키 기반으로 바뀐다.
- 기존 UI 동작은 유지된다.

### 6.4 4단계: GameManager 메시지 전환

작업:

- `GameManager`에 `i18n`을 주입한다.
- toast/error/confirm 메시지를 key 기반으로 전환한다.
- 동적 값이 들어가는 메시지는 interpolation을 사용한다.

완료 기준:

- `world regenerated`, `BGM unavailable`, `navigation engaged` 같은 메시지가 locale catalog에서 온다.

### 6.5 5단계: Definition Catalog 표시 문자열 전환

작업:

- item/building/sector 정의에 `label_key`, `description_key`를 추가한다.
- `definitionIndexes.js`에 표시 문자열 resolve helper를 추가한다.
- `name`, `name_en`, `description`은 임시 fallback으로 둔다.
- scanner/object list는 definition 표시명을 i18n helper로 가져온다.

완료 기준:

- 아이템/건물/섹터 표시명이 locale catalog에서 올 수 있다.
- 저장되는 월드 인스턴스는 ID 중심 구조를 유지한다.

### 6.6 6단계: Locale 설정 UI

작업:

- Settings에 Language 선택 컨트롤 추가
- 선택값을 `localStorage["beta-void-locale"]`에 저장
- 변경 시 현재 화면 문자열을 다시 적용하거나 reload 유도 방식을 선택

초기 구현 권장:

- 변경 즉시 `location.reload()`로 단순하게 처리한다.
- 실시간 전체 re-render는 이후 단계에서 검토한다.

완료 기준:

- 사용자가 `ko`/`en`을 선택할 수 있다.
- 재실행 후 선택 언어가 유지된다.

## 7. 검증 계획

### 7.1 정적 검증

- locale별 필수 키 존재 검사
- fallback locale에 모든 기준 키가 있는지 검사
- 정의 catalog의 `label_key`, `description_key`가 locale에 존재하는지 검사

예상 검증 함수:

```js
validateI18nCatalog({ messages, fallbackLocale: "en" });
validateDefinitionI18nKeys({ definitions, messages });
```

### 7.2 브라우저 검증

- `?reset=1` 실행 후 초기 화면 로드
- Settings 열기
- Scanner 열기
- Object detail 열기
- locale 변경 후 reload
- toast/error 문구 노출 확인

### 7.3 회귀 확인

- 기존 key binding 동작 유지
- world reset/reload 동작 유지
- BGM/ship/world loading 흐름 유지
- scanner object navigation 유지

## 8. 이번 i18n 기반 단계에서 하지 않을 것

- 모든 문장의 완성 번역
- 복수형/성별/격 변화 등 고급 메시지 포맷
- RTL 언어 대응
- 서버 기반 번역 로딩
- 저장된 월드 데이터 migration
- 정의 데이터에서 `name/name_en/description` 즉시 삭제

## 9. 위험 요소와 대응

### 9.1 초기화 순서

UI가 만들어지기 전에 i18n 인스턴스가 준비되어야 한다.

대응:

- `main.js` 또는 `GameManager.init()` 초기에 locale을 결정한다.
- `UIManager` 생성 시 i18n 인스턴스를 필수 의존성으로 넘긴다.

### 9.2 저장 데이터에 표시 문자열이 섞이는 문제

현재 sector instance는 `name`을 포함한다.

대응:

- 단기적으로 유지하되 표시 시에는 `sector_id` 기반 i18n resolve를 우선한다.
- 장기적으로 인스턴스에는 `sector_id`, 정의에는 표시 문자열 키를 둔다.

### 9.3 누락 키가 조용히 지나가는 문제

대응:

- 개발 모드에서 missing key 목록을 수집한다.
- 검증 스크립트로 fallback locale 누락을 실패 처리한다.

## 10. 권장 첫 작업

첫 구현은 최소 수직 절편으로 진행한다.

1. `js/i18n/i18n.js` 작성
2. `js/i18n/locales/en.js`, `ko.js` 작성
3. `UIManager`의 start/settings/scanner 핵심 문구 일부만 i18n으로 전환
4. locale 선택 없이 기본 locale 결정과 fallback만 검증
5. 브라우저에서 기존 흐름이 깨지지 않는지 확인

이 절편이 안정화되면 definition catalog와 settings language selector로 확장한다.
