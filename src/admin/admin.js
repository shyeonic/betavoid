import { OnlineApiClient } from "../js/OnlineApiClient.js";
import { OnlineIdentityManager } from "../js/OnlineIdentityManager.js";

const REBUILD_CONFIRMATION = "REBUILD PRIMARY WORLD";
const identity = new OnlineIdentityManager();
const api = new OnlineApiClient({ identity });
const elements = Object.fromEntries(
  [
    "adminIdentity",
    "activeRouteMetric",
    "appShell",
    "authMessage",
    "authView",
    "betaVoidMetric",
    "buildingMetric",
    "connectionStatus",
    "dataSourceValue",
    "dialogCloseButton",
    "dialogJson",
    "dialogTitle",
    "dialogType",
    "entityDialog",
    "entityRows",
    "entityTypeFilter",
    "errorBanner",
    "generatedValue",
    "fieldShipMetric",
    "historyRouteFilter",
    "historyRows",
    "historyShipFilter",
    "historyStatus",
    "historyStatusFilter",
    "nextButton",
    "pageStatus",
    "previousButton",
    "rebuildButton",
    "rebuildConfirmation",
    "refreshButton",
    "resourceMetric",
    "revisionMetric",
    "sectorFilter",
    "sectorRows",
    "seedValue",
    "signInButton",
    "signOutButton",
    "shipRows",
    "shipModeFilter",
    "shipSearchFilter",
    "shipSectorFilter",
    "storageMetric",
    "worldIdValue"
  ].map((id) => [id, document.getElementById(id)])
);

const state = {
  admin: null,
  summary: null,
  ships: [],
  movements: [],
  entities: [],
  nextCursor: "",
  cursor: "",
  cursorHistory: [],
  loading: false
};

elements.signInButton.addEventListener("click", async () => {
  setAuthMessage("Google 계정 선택 중");
  try {
    await identity.signInWithGoogle();
  } catch (error) {
    setAuthMessage(describeError(error));
  }
});
elements.signOutButton.addEventListener("click", () => identity.signOut());
elements.refreshButton.addEventListener("click", () => refreshDashboard());
elements.entityTypeFilter.addEventListener("change", () => resetAndLoadEntities());
elements.sectorFilter.addEventListener("change", () => resetAndLoadEntities());
elements.shipSearchFilter.addEventListener("input", () => renderShips());
elements.shipModeFilter.addEventListener("change", () => renderShips());
elements.shipSectorFilter.addEventListener("change", () => renderShips());
elements.historyShipFilter.addEventListener("change", () => loadMovementHistory());
elements.historyRouteFilter.addEventListener("change", () => loadMovementHistory());
elements.historyStatusFilter.addEventListener("change", () => loadMovementHistory());
elements.nextButton.addEventListener("click", () => {
  if (!state.nextCursor) return;
  state.cursorHistory.push(state.cursor);
  state.cursor = state.nextCursor;
  void loadEntities();
});
elements.previousButton.addEventListener("click", () => {
  state.cursor = state.cursorHistory.pop() || "";
  void loadEntities();
});
elements.rebuildConfirmation.addEventListener("input", updateRebuildButton);
elements.rebuildButton.addEventListener("click", () => rebuildWorld());
elements.dialogCloseButton.addEventListener("click", () => elements.entityDialog.close());
elements.entityDialog.addEventListener("click", (event) => {
  if (event.target === elements.entityDialog) elements.entityDialog.close();
});

identity.subscribe(() => {
  void syncIdentity();
});

await identity.init();

async function syncIdentity() {
  if (!identity.isAuthenticated) {
    state.admin = null;
    elements.appShell.hidden = true;
    elements.authView.hidden = false;
    elements.signInButton.hidden = !identity.available;
    setAuthMessage(identity.available
      ? "관리자 Google 계정으로 로그인"
      : "Firebase Auth를 사용할 수 없습니다");
    document.body.dataset.state = "signed-out";
    return;
  }

  elements.signInButton.hidden = true;
  setAuthMessage("관리자 권한 확인 중");
  try {
    state.admin = await api.getAdminSession();
    elements.adminIdentity.textContent = state.admin?.email || identity.identity.email || "";
    elements.authView.hidden = true;
    elements.appShell.hidden = false;
    document.body.dataset.state = "ready";
    await refreshDashboard();
  } catch (error) {
    document.body.dataset.state = "denied";
    elements.appShell.hidden = true;
    elements.authView.hidden = false;
    elements.signInButton.hidden = false;
    setAuthMessage(describeError(error));
  }
}

async function refreshDashboard() {
  if (state.loading || !identity.isAuthenticated) return;
  setLoading(true);
  clearError();
  try {
    [state.summary, state.ships] = await Promise.all([
      api.getAdminWorldSummary(),
      api.listAdminNavigationShips()
    ]);
    renderSummary();
    populateNavigationFilters();
    renderShips();
    await Promise.all([
      resetAndLoadEntities(),
      loadMovementHistory()
    ]);
    setConnectionStatus("온라인", true);
  } catch (error) {
    showError(describeError(error));
    setConnectionStatus("연결 오류", false);
  } finally {
    setLoading(false);
  }
}

async function resetAndLoadEntities() {
  state.cursor = "";
  state.nextCursor = "";
  state.cursorHistory = [];
  await loadEntities();
}

async function loadEntities() {
  clearError();
  try {
    const result = await api.listAdminWorldEntities({
      entityType: elements.entityTypeFilter.value,
      sectorId: elements.sectorFilter.value,
      cursor: state.cursor,
      limit: 50
    });
    state.entities = result.entities;
    state.nextCursor = result.nextCursor;
    renderEntities();
  } catch (error) {
    showError(describeError(error));
  }
}

async function loadMovementHistory() {
  clearError();
  try {
    state.movements = await api.listAdminNavigationHistory({
      shipUid: elements.historyShipFilter.value,
      routeType: elements.historyRouteFilter.value,
      status: elements.historyStatusFilter.value,
      limit: 200
    });
    renderMovementHistory();
  } catch (error) {
    showError(describeError(error));
  }
}

function renderSummary() {
  const { world, counts, sectors, navigation } = state.summary || {};
  elements.revisionMetric.textContent = formatNumber(world?.revision);
  elements.resourceMetric.textContent = formatNumber(counts?.resource_nodes);
  elements.buildingMetric.textContent = formatNumber(counts?.buildings);
  elements.betaVoidMetric.textContent = formatNumber(counts?.beta_voids);
  elements.storageMetric.textContent = formatNumber(counts?.world_storages);
  elements.fieldShipMetric.textContent = formatNumber(navigation?.field_ships);
  elements.activeRouteMetric.textContent = formatNumber(navigation?.active_movements);
  elements.worldIdValue.textContent = world?.world_id || "-";
  elements.seedValue.textContent = world?.seed || "-";
  elements.dataSourceValue.textContent = world?.data_source_key || "-";
  elements.generatedValue.textContent = formatDate(world?.generated_at);

  elements.sectorRows.replaceChildren(
    ...(sectors || []).map((sector) => {
      const row = document.createElement("tr");
      appendCell(row, sector.name || sector.sector_id);
      appendCell(row, formatNumber(sector.counts?.resource_node));
      appendCell(row, formatNumber(sector.counts?.building));
      appendCell(row, formatNumber(sector.counts?.beta_void));
      return row;
    })
  );

  const previousValue = elements.sectorFilter.value;
  elements.sectorFilter.replaceChildren(
    new Option("전체", ""),
    ...(sectors || []).map((sector) => new Option(
      sector.name || sector.sector_id,
      sector.sector_id
    ))
  );
  if ([...elements.sectorFilter.options].some((option) => option.value === previousValue)) {
    elements.sectorFilter.value = previousValue;
  }
  updateRebuildButton();
}

function renderShips() {
  const query = elements.shipSearchFilter.value.trim().toLowerCase();
  const mode = elements.shipModeFilter.value;
  const sectorId = elements.shipSectorFilter.value;
  const ships = state.ships.filter((ship) => {
    if (mode && ship.spatial_mode !== mode) return false;
    if (sectorId && ship.sector_id !== sectorId) return false;
    if (!query) return true;
    return [
      ship.display_name,
      ship.owner_character_id,
      ship.ship_uid,
      ship.ship_definition_id
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
  elements.shipRows.replaceChildren(
    ...ships.map((ship) => {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      appendCell(row, ship.display_name || ship.owner_character_id);
      appendCell(row, `${ship.ship_definition_id} / ${ship.ship_uid}`);
      appendCell(row, ship.spatial_mode);
      appendCell(row, ship.sector_id || ship.chunk_id || "-");
      appendCell(row, ship.custody
        ? `${ship.custody.id} @ ${formatVector(ship.resolved_position)}`
        : formatVector(ship.position));
      appendCell(row, formatNumber(Math.round(Number(ship.speed) || 0)));
      appendCell(row, ship.phase || "-");
      appendCell(row, ship.route_type || "-");
      appendCell(row, formatDate(ship.updated_at));
      const open = () => openShip(ship);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      return row;
    })
  );
}

function populateNavigationFilters() {
  replaceSelectOptions(
    elements.shipSectorFilter,
    [...new Set(state.ships.map((ship) => ship.sector_id).filter(Boolean))]
      .sort()
      .map((sectorId) => ({ label: sectorId, value: sectorId }))
  );
  replaceSelectOptions(
    elements.historyShipFilter,
    state.ships
      .map((ship) => ({
        label: `${ship.display_name || ship.owner_character_id} / ${ship.ship_definition_id}`,
        value: ship.ship_uid
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );
}

function replaceSelectOptions(select, options) {
  const previousValue = select.value;
  select.replaceChildren(
    new Option("All", ""),
    ...options.map((option) => new Option(option.label, option.value))
  );
  if ([...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

function renderMovementHistory() {
  elements.historyRows.replaceChildren(
    ...state.movements.map((movement) => {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      appendCell(row, formatDate(movement.issued_at));
      appendCell(row, movement.display_name || movement.owner_character_id);
      appendCell(row, `${movement.ship_definition_id} / ${movement.ship_uid}`);
      appendCell(row, movement.route_type);
      appendCell(row, movement.status);
      appendCell(row, formatVector(movement.from_position));
      appendCell(row, formatVector(movement.target));
      appendCell(row, movement.resolved_phase || "-");
      appendCell(row, formatDate(resolveMovementTimestamp(movement)));
      const open = () => openMovement(movement);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      return row;
    })
  );
  elements.historyStatus.textContent = `${state.movements.length} records`;
}

async function openShip(ship) {
  elements.dialogType.textContent = "SHIP";
  elements.dialogTitle.textContent = ship.display_name || ship.ship_uid;
  elements.dialogJson.textContent = "Loading...";
  if (!elements.entityDialog.open) elements.entityDialog.showModal();
  try {
    const recentMovements = await api.listAdminNavigationHistory({
      shipUid: ship.ship_uid,
      limit: 20
    });
    elements.dialogJson.textContent = JSON.stringify({
      ship,
      recent_movements: recentMovements
    }, null, 2);
  } catch (error) {
    elements.dialogJson.textContent = describeError(error);
  }
}

function openMovement(movement) {
  elements.dialogType.textContent = "MOVEMENT CONTRACT";
  elements.dialogTitle.textContent = movement.contract_id;
  elements.dialogJson.textContent = JSON.stringify(movement, null, 2);
  if (!elements.entityDialog.open) elements.entityDialog.showModal();
}

function resolveMovementTimestamp(movement) {
  if (movement.status === "CANCELED") return movement.canceled_at;
  if (movement.status === "ARRIVED") return movement.settled_at || movement.arrive_at;
  return null;
}

function renderEntities() {
  elements.entityRows.replaceChildren(
    ...state.entities.map((entity) => {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      appendCell(row, entity.entity_type);
      appendCell(row, entity.entity_id);
      appendCell(row, entity.sector_id || "-");
      appendCell(row, entity.chunk_id || "-");
      appendCell(row, formatNumber(entity.revision));
      appendCell(row, formatDate(entity.updated_at));
      const open = () => openEntity(entity);
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      return row;
    })
  );
  elements.pageStatus.textContent = `${state.entities.length}개`;
  elements.previousButton.disabled = state.cursorHistory.length === 0;
  elements.nextButton.disabled = !state.nextCursor;
}

function openEntity(entity) {
  elements.dialogType.textContent = entity.entity_type;
  elements.dialogTitle.textContent = entity.entity_id;
  elements.dialogJson.textContent = JSON.stringify(entity.state, null, 2);
  elements.entityDialog.showModal();
}

async function rebuildWorld() {
  if (
    elements.rebuildConfirmation.value !== REBUILD_CONFIRMATION
    || !state.summary?.world
  ) return;
  const confirmed = window.confirm("Primary World를 새 revision으로 재생성합니다.");
  if (!confirmed) return;

  elements.rebuildButton.disabled = true;
  clearError();
  try {
    await api.rebuildAdminWorld({
      expectedRevision: state.summary.world.revision,
      confirmation: REBUILD_CONFIRMATION
    });
    elements.rebuildConfirmation.value = "";
    await refreshDashboard();
  } catch (error) {
    showError(describeError(error));
  } finally {
    updateRebuildButton();
  }
}

function updateRebuildButton() {
  elements.rebuildButton.disabled = state.loading
    || !state.summary?.world
    || elements.rebuildConfirmation.value !== REBUILD_CONFIRMATION;
}

function setLoading(loading) {
  state.loading = loading;
  elements.refreshButton.disabled = loading;
  updateRebuildButton();
}

function setConnectionStatus(label, online) {
  elements.connectionStatus.textContent = label;
  elements.connectionStatus.classList.toggle("online", online);
}

function setAuthMessage(message) {
  elements.authMessage.textContent = message;
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.hidden = false;
}

function clearError() {
  elements.errorBanner.hidden = true;
  elements.errorBanner.textContent = "";
}

function appendCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  cell.title = value;
  row.append(cell);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR") : "-";
}

function formatDate(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "medium"
    }).format(timestamp)
    : "-";
}

function formatVector(value) {
  if (!value || typeof value !== "object") return "-";
  return [
    Math.round(Number(value.x) || 0),
    Math.round(Number(value.y) || 0),
    Math.round(Number(value.z) || 0)
  ].map((component) => component.toLocaleString("ko-KR")).join(", ");
}

function describeError(error) {
  if (error?.code === "ADMIN_REQUIRED") return "이 계정에는 관리자 권한이 없습니다.";
  if (error?.code === "WORLD_REVISION_CONFLICT") return "월드 revision이 변경되었습니다. 새로고침 후 다시 시도하세요.";
  if (error?.code === "AUTH_REQUIRED") return "Google 로그인이 필요합니다.";
  return error?.message || "관리자 API 요청에 실패했습니다.";
}
