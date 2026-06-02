# 항법 권위 서버 설계 — Navigation Authority System

> 작성 기준: 2026-06-01  
> 참조 구현: `non-product-test-and-sample/flight-viewer.html`  
> 대상 파일: `js/GameManager.js`, `js/WorldDataManager.js`

---

## 1. 현황 분석

### 1-1. 현재 아키텍처

```
[클라이언트 물리 엔진]
  updateSpeed(dt) + updatePosition(dt)
         ↓ 1초 throttle
[playerShipState] ← IndexedDB meta store (단일 스냅샷, 덮어쓰기)
         ↓
[navLogs]          ← 자동항해 명령 누적 (active / completed / cancelled)
```

**현재 저장 사이클**

| 데이터 | 저장 주기 | 방식 | 위치 |
|--------|-----------|------|------|
| `playerShipState` | 1000ms throttle + force (이벤트 시) | 단일 레코드 덮어쓰기 | `meta["playerShip"]` |
| `navLogs` | 명령 발생 시 즉시 | 누적 append | `navLogs[id]` |

**현재 저장 스키마 — playerShipState**
```javascript
{
  key: "playerShip",
  ship_id, player_id,
  position: { x, y, z },         // data-space
  rotation: { x, y, z, w },
  chunk_id, chunk, sector_id,
  speed, desiredSpeed,
  updated_at                      // 마지막 저장 시각
}
```

**현재 저장 스키마 — navLog**
```javascript
{
  id,                             // "NAV-{ts}-{hex}"
  type,                           // "standard" | "glide"
  issued_at,
  from_position, target,          // render-space
  flight_start_at, peak_speed, flight_duration,
  status,                         // "active" | "completed" | "cancelled"
  completed_at, cancelled_at
}
```

### 1-2. 현재 구조의 한계

| 항목 | 문제 |
|------|------|
| **수동 항법 추적 없음** | 수동 비행 중 위치가 1초 스냅샷 하나에만 의존 → 비정상 종료 시 정밀도 낮음 |
| **SSoT 부재** | `playerShipState`가 현재 상태의 근거이지만, 이를 "파생"시킨 명령이 없음 |
| **물리 파라미터 미보존** | 저장 시점의 `accelerationRate` / `decelerationRate`가 navLog에 없음 → 파라미터 변경 시 재계산 오류 가능 |
| **시퀀스 번호 없음** | 명령 순서 보장 불가, 중복 쓰기 감지 불가 |
| **에폭 / 버전 없음** | 저장 포맷 변경 시 기존 데이터 처리 전략 없음 |
| **권위 검증 없음** | 클라이언트가 보낸 위치를 그대로 저장 → 불가능한 이동 감지 불가 (서버 확장 시 문제) |

---

## 2. flight-viewer.html 참조 아키텍처

`flight-viewer.html`은 "내부 로컬 권위 서버"를 시뮬레이션하는 완전한 구현체다.  
이하 핵심 개념을 추출한다.

### 2-1. AuthoritativeNavServer — 상태 파생 모델

```
저장된 명령 로그 (commands)
       ↓
deriveState(nowMs) → 현재 상태 계산
```

서버는 "스냅샷"이 아니라 **마지막 수락된 명령**을 저장하고, 항상 `nowMs`를 기반으로 현재 상태를 파생시킨다.

```javascript
// 핵심 상태 구조
{
  lastAcceptedPosition: { x, y, z },  // 마지막으로 수락된 위치
  lastAcceptedAtMs: number,           // 그 시각
  lastAcceptedSeq: number,            // 단조 증가 시퀀스
  activeRoute: Route | null,          // 진행 중인 자동항해 루트
  shipSnapshot: { maxSpeed, accelRate, decelRate, manualMaxSpeed },
  economyEpoch: string                // 포맷 버전
}
```

### 2-2. MOVE_CHECKPOINT — 수동 항법 체크포인트

수동 비행 중 **결정 주기마다** 전송 여부를 판단한다.

```
판단 주기: 500ms
전송 기준 (OR 조건):
  ① stopReady  — N 결정 연속 정지 + 미보고 이동 >= 1m
  ② timeReady  — 마지막 전송 후 6초 경과 + 이동 >= 15m
  ③ distReady  — 마지막 보고 위치로부터 이동 >= 90m

전송 보류 조건:
  - 이미 pending 중
  - dirty 플래그 → 다음 결정 주기에 강제 전송
```

체크포인트 페이로드:
```javascript
{
  clientActionId, clientSeq,
  position: { x, y, z }
}
```

### 2-3. 권위 보정 흐름 (Correction Flow)

```
서버 응답 → ok=false → queueAuthorityCorrection()
                              ↓
              pendingAuthorityCorrection = { position, applyAtMs }
                              ↓ (latency delay 후)
              applyAuthorityCorrection()
                → 위치 강제 적용 + checkpoint 추적 리셋
```

### 2-4. 수락 허용 범위 (Allowance Window)

```
allowance = manualMaxSpeed * elapsedSeconds * grace + fixedBuffer
```

서버는 `lastAcceptedAtMs`로부터 경과 시간과 최대 속도로 "도달 가능한 범위"를 계산하여 체크포인트를 수락/거절한다.

---

## 3. 목표 아키텍처 — SSoT 내부 권위 서버

### 3-1. 설계 원칙

```
WorldDataManager = 내부 권위 서버 (SSoT)
  - 모든 위치는 "마지막으로 수락된 명령"으로부터 파생
  - playerShipState = 파생 캐시 (보조 데이터)
  - navLogs + moveLogs = 1차 진실 (primary record)
```

### 3-2. 전체 데이터 흐름

```
[클라이언트 물리 엔진]
       |
       ├── 자동항해 명령 발생
       │     → createNavLog(type="standard")
       │     → updateNavLog(flight_start_at, peak_speed, ...)
       │
       ├── 수동 항법 체크포인트 결정 (500ms)
       │     → createMoveLog(position, speed, clientSeq, ...)
       │
       ├── 접속 종료 (pagehide)
       │     → createNavLog(type="glide") / createMoveLog(type="session_end")
       │     → savePlayerShipState(force)  ← 파생 캐시 갱신
       │
       └── 재접속
             → WorldDataManager.deriveCurrentState(nowMs)
                  ├── 활성 navLog 있음 → 결정론적 위치 계산
                  ├── 최근 moveLog 있음 → 글라이드 합성
                  └── fallback → playerShipState 캐시
```

---

## 4. 신규 데이터 구조 설계

### 4-1. authorityState (meta store)

```javascript
{
  key: "authorityState",
  lastAcceptedPosition: { x, y, z },   // render-space (현재 navLog 좌표계와 통일)
  lastAcceptedAtMs: number,
  lastAcceptedSeq: number,
  activeNavLogId: string | null,        // 현재 진행 중인 navLog ID
  shipSnapshot: {
    accelerationRate: number,
    decelerationRate: number,
    maxSpeed: number,
    arrivalRadius: number
  },
  economyEpoch: string,                 // e.g. "local-v1"
  updated_at: number
}
```

**역할**: `playerShipState` 대신 "마지막으로 검증된 상태"의 근거가 된다.

### 4-2. navLog 스키마 확장

기존 필드 유지, 아래 필드 추가:

```javascript
{
  // --- 기존 ---
  id, type, issued_at, from_position, target,
  flight_start_at, peak_speed, flight_duration,
  status, completed_at, cancelled_at,

  // --- 신규 ---
  clientSeq: number,                    // 단조 증가 시퀀스 (authorityState.lastAcceptedSeq 기반)
  shipSnapshot: {                       // 명령 발행 시점의 물리 파라미터
    accelerationRate,
    decelerationRate,
    maxSpeed,
    arrivalRadius
  },
  economyEpoch: string
}
```

**중요**: `computeNavPositionAtTime`은 `config.accelerationRate` 대신 `log.shipSnapshot.decelerationRate`를 사용하도록 변경 예정 → 파라미터 변경에 독립적인 재계산 보장.

### 4-3. moveLog (신규 store)

수동 항법 체크포인트 + 세션 이벤트를 저장하는 별도 store.

```javascript
// store: "moveLogs", keyPath: "id"
{
  id: string,                           // "MOVE-{ts}-{hex}"
  type: "checkpoint" | "session_end" | "session_start",
  issued_at: number,                    // 클라이언트 전송 시각

  // checkpoint 타입
  clientSeq: number,                    // 단조 증가
  position: { x, y, z },               // render-space
  speed: number,
  heading: { x, y, z },                // forward vector
  shipSnapshot: { ... },

  // session_end 타입 (접속 종료 시점 상태)
  speed: number,
  position: { x, y, z },
  heading: { x, y, z },
  glide_stop_position: { x, y, z },    // 예측 정지 위치
  glide_duration: number,              // 정지까지 소요 시간(초)

  // 공통
  status: "accepted" | "pending",
  economyEpoch: string
}
```

---

## 5. 저장/동기화 전략

### 5-1. 저장 주기 비교 및 목표

| 데이터 | 현재 주기 | 목표 주기 | 비고 |
|--------|-----------|-----------|------|
| `playerShipState` | 1000ms throttle | 유지 (파생 캐시) | 역할은 보조 캐시로 격하 |
| `navLogs` | 이벤트 즉시 | 유지 + shipSnapshot 포함 | |
| `moveLogs` | 없음 | 신규: 체크포인트 결정 주기 | 아래 기준 참조 |
| `authorityState` | 없음 | 체크포인트 수락 시 갱신 | |

### 5-2. 수동 체크포인트 결정 로직 (flight-viewer 참조)

```
결정 주기: 500ms (checkpointDecisionIntervalMs)

전송 기준 (OR):
  ① stopReady  : 연속 N회 정지 판정 + 미보고 이동 >= 1m + 아직 미전송
  ② timeReady  : 마지막 전송 6초 이상 경과 + 이동 >= 15m  
  ③ distReady  : 마지막 체크포인트로부터 90m 이상 이동

전송 보류:
  - pending 중이면 dirty = true → 다음 결정 주기에 강제 전송

보류 조건 해소:
  - 체크포인트 수락 응답 후 dirty=true면 즉시 재결정
```

**GameManager에 추가될 상태:**
```javascript
this.manualSync = {
  clientSeq: 0,
  lastSentAtMs: 0,
  lastDecisionAtMs: 0,
  lastCheckpointPosition: new THREE.Vector3(),
  lastObservationPosition: new THREE.Vector3(),
  stationaryDecisionCount: 0,
  stationaryCheckpointSent: false,
  dirty: false,
  pending: false
};
```

### 5-3. 접속 종료 처리 (pagehide)

```
pagehide 발생
  ├── autopilotPhase === null && speed > 0
  │     → createNavLog(type="glide", ...)     ← 이미 구현
  │     → createMoveLog(type="session_end", speed, position, heading, glide_stop_position)
  │
  ├── autopilotPhase !== null
  │     → 기존 navLog가 권위 데이터 (추가 조치 불필요)
  │
  └── savePlayerShipState(force=true)
        + updateAuthorityState(position, seq, ...)
```

---

## 6. 복원/파생 전략 (deriveCurrentState)

재접속 시 `WorldDataManager.deriveCurrentState(nowMs)` → `GameManager.restorePlayerShipState()` 흐름 정리.

```
우선순위 1: 활성 navLog (flight_start_at 있음)
  → type=standard: computeNavPositionAtTime(log, tSec)
  → type=glide:    computeGlidePositionAtTime(log, tSec)
  ※ log.shipSnapshot 물리 파라미터 사용

우선순위 2: 활성 navLog (flight_start_at 없음, stopping/aligning 중 종료)
  → autopilotPhase = "stopping" 재개
  → 위치는 아래 moveLogs 기반

우선순위 3: 최신 moveLog (session_end 또는 마지막 checkpoint)
  → session_end: glide 합성 (from_position + heading * stopDist)
  → checkpoint:  acceptedPosition을 기준점으로 사용

우선순위 4: playerShipState 캐시 (fallback)
  → 기존 글라이드 합성 로직 유지
```

---

## 7. 구현 단계

### Phase 1 — 기초 확장 (현재 → 다음 단계)

**목표**: 기존 동작 유지, 스키마 확장

- [ ] `navLog.shipSnapshot` 필드 추가 — `createNavLog` / `updateAutopilot` 수정
- [ ] `navLog.clientSeq` 필드 추가 — `authorityState.lastAcceptedSeq` 기반
- [ ] `authorityState` meta 레코드 신설 — 읽기/쓰기 메서드 추가
- [ ] `computeNavPositionAtTime` / `computeGlidePositionAtTime`에서 `log.shipSnapshot` 사용
- [ ] DB version 7 마이그레이션 (navLogs 기존 레코드는 config 기본값으로 shipSnapshot 채움)

**예상 작업량**: 소~중

---

### Phase 2 — moveLog 도입

**목표**: 수동 항법 기록을 SSoT에 포함

- [ ] `moveLogs` IndexedDB store 신설 (DB version 8)
- [ ] `WorldDataManager.createMoveLog()` / `getMoveLogs()` 메서드
- [ ] `GameManager.manualSync` 상태 추가
- [ ] `updateManualCheckpoint()` 업데이트 루프 추가 (500ms 결정 주기)
- [ ] `sendMoveCheckpoint()` — `createMoveLog({ type: "checkpoint", ... })`
- [ ] `pagehide` 핸들러에 `createMoveLog({ type: "session_end", ... })` 추가
- [ ] `restorePlayerShipState`에 moveLog 기반 복원 경로 추가 (우선순위 3)

**예상 작업량**: 중~대

---

### Phase 3 — authorityState 활성화

**목표**: `playerShipState`를 파생 캐시로 격하, `authorityState`를 SSoT로 승격

- [ ] `authorityState` 읽기/쓰기 완전 통합
- [ ] 체크포인트 수락 시 `authorityState.lastAcceptedPosition` 갱신
- [ ] `deriveCurrentState(nowMs)` 메서드 신설 (현재 `restorePlayerShipState` 로직 대체)
- [ ] `playerShipState`는 렌더링 편의 캐시로만 사용

**예상 작업량**: 중

---

### Phase 4 — 권위 검증 (온라인 확장 준비)

**목표**: 허용 범위 검증 내재화 → 추후 실제 서버로 이관 가능한 구조

- [ ] `validateMoveCheckpoint(position, serverReceivedAtMs)` — allowance 계산
- [ ] 검증 실패 시 권위 보정 큐 (`pendingAuthorityCorrection`) 적용
- [ ] 보정 지연 (localAuthority: 즉시, remoteServer: 네트워크 latency 후)
- [ ] `economyEpoch` 불일치 시 전체 상태 재동기화

**예상 작업량**: 중~대 (온라인 게임 전환 시 외부 서버로 교체)

---

## 8. 마이그레이션 계획

| DB 버전 | 변경 내용 |
|---------|-----------|
| 현재 v6 | 기존 스키마 |
| v7 (Phase 1) | navLogs 읽기 시 shipSnapshot 없으면 config 기본값 주입 (코드 레벨, DB 마이그레이션 불필요) |
| v8 (Phase 2) | `moveLogs` store 신설 |
| v9 (Phase 3) | `meta["authorityState"]` 초기화 |

> **원칙**: 기존 레코드는 파괴하지 않는다. 새 필드가 없는 구 레코드는 코드에서 기본값으로 처리한다.

---

## 9. 파일별 변경 요약

| 파일 | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| `worldDefinitions.js` | dbVersion 7 | dbVersion 8 | dbVersion 9 |
| `WorldDataManager.js` | createNavLog에 shipSnapshot | createMoveLog, moveLogs store | authorityState CRUD, deriveCurrentState |
| `GameManager.js` | navLog 생성 시 shipSnapshot 전달 | manualSync 추가, updateManualCheckpoint | restorePlayerShipState → deriveCurrentState 래핑 |

---

## 10. 참조 개념 대응표

| flight-viewer | 현재 게임 | 목표 게임 |
|---------------|-----------|-----------|
| `AuthoritativeNavServer` | 없음 | `WorldDataManager` (SSoT 역할) |
| `deriveState(nowMs)` | `restorePlayerShipState` (재시작에만) | `deriveCurrentState(nowMs)` (이벤트마다) |
| `ServerLogStore` | `navLogs` (autopilot만) | `navLogs` + `moveLogs` (통합) |
| `MOVE_CHECKPOINT` | 없음 | `moveLog.type="checkpoint"` |
| `session_end` 개념 | `_commitGlideNavLog` + playerShipState | `moveLog.type="session_end"` |
| `shipSnapshot` | 없음 | `navLog.shipSnapshot` + `moveLog.shipSnapshot` |
| `economyEpoch` | 없음 | `authorityState.economyEpoch` |
| `pendingAuthorityCorrection` | 없음 | Phase 4에서 도입 |
| `clientSeq` | 없음 | `navLog.clientSeq`, `moveLog.clientSeq` |
| `allowance window` | 없음 | Phase 4에서 도입 |
