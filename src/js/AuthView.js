const AUTH_ERROR_MESSAGES = {
  "auth/popup-closed-by-user": "Google 로그인이 취소되었습니다.",
  "auth/cancelled-popup-request": "진행 중인 로그인 창에서 계정을 선택해 주세요.",
  "auth/popup-blocked": "브라우저에서 로그인 팝업을 허용한 뒤 다시 시도해 주세요.",
  "auth/unauthorized-domain": "현재 주소가 Firebase 승인 도메인에 등록되지 않았습니다.",
  "auth/network-request-failed": "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
  "auth/operation-not-allowed": "Firebase에서 Google 로그인을 활성화해야 합니다.",
  "auth/admin-restricted-operation": "Firebase Authentication 설정을 완료해야 합니다."
};

export function createAuthGate({ root, onSignIn }) {
  const section = document.createElement("section");
  section.className = "auth-gate";
  section.setAttribute("aria-labelledby", "authGateTitle");
  section.innerHTML = `
    <div class="auth-gate__content">
      <div class="auth-gate__brand" aria-label="beta-void">
        <span class="auth-gate__brand-mark" aria-hidden="true">BV</span>
        <span>beta-void</span>
      </div>
      <div class="auth-gate__copy">
        <p class="auth-gate__eyebrow">MULTIPLAYER ACCESS</p>
        <h1 id="authGateTitle">Google 계정으로 계속하기</h1>
        <p>온라인 플레이를 시작하려면 로그인이 필요합니다.</p>
      </div>
      <button class="auth-gate__button" type="button" data-auth-sign-in>
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path fill="#4285f4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"/>
          <path fill="#34a853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"/>
          <path fill="#fbbc05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33Z"/>
          <path fill="#ea4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.63 8.63 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"/>
        </svg>
        <span data-auth-button-label>Google로 로그인</span>
      </button>
      <p class="auth-gate__status" data-auth-status role="status" aria-live="polite"></p>
    </div>
    <p class="auth-gate__footer">SECURE CONNECTION / FIREBASE AUTH</p>
  `;

  root.replaceChildren(section);

  const button = section.querySelector("[data-auth-sign-in]");
  const label = section.querySelector("[data-auth-button-label]");
  const status = section.querySelector("[data-auth-status]");

  button.addEventListener("click", async () => {
    setState({ busy: true, message: "Google 로그인 창을 여는 중입니다." });
    try {
      await onSignIn();
    } catch (error) {
      setState({ busy: false, error });
    }
  });

  function setState({ busy = false, checking = false, starting = false, error = null, message = "" } = {}) {
    const disabled = busy || checking || starting;
    button.disabled = disabled;
    section.dataset.state = checking ? "checking" : starting ? "starting" : busy ? "busy" : "ready";
    label.textContent = checking
      ? "로그인 확인 중"
      : starting
        ? "게임 접속 중"
        : busy
          ? "Google 연결 중"
          : "Google로 로그인";

    status.classList.toggle("is-error", Boolean(error));
    status.textContent = error ? getAuthErrorMessage(error) : message;
  }

  return {
    element: section,
    setState,
    destroy() {
      section.remove();
    }
  };
}

export function createAuthSessionMenu({ identity, onSignOut }) {
  const container = document.createElement("div");
  container.className = "auth-session";
  container.innerHTML = `
    <button class="auth-session__trigger" type="button" aria-label="계정 메뉴" aria-expanded="false">
      <span class="auth-session__avatar" aria-hidden="true"></span>
    </button>
    <div class="auth-session__menu" hidden>
      <div class="auth-session__identity">
        <strong></strong>
        <span></span>
      </div>
      <button class="auth-session__sign-out" type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
        </svg>
        <span>로그아웃</span>
      </button>
    </div>
  `;

  const trigger = container.querySelector(".auth-session__trigger");
  const avatar = container.querySelector(".auth-session__avatar");
  const menu = container.querySelector(".auth-session__menu");
  const signOutButton = container.querySelector(".auth-session__sign-out");
  const name = container.querySelector(".auth-session__identity strong");
  const email = container.querySelector(".auth-session__identity span");

  name.textContent = identity.displayName || "Pilot";
  email.textContent = identity.email || "";

  if (identity.photoURL) {
    const image = document.createElement("img");
    image.src = identity.photoURL;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    avatar.append(image);
  } else {
    avatar.textContent = (identity.displayName || identity.email || "P").trim().charAt(0).toUpperCase();
  }

  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  const onDocumentPointerDown = (event) => {
    if (!container.contains(event.target)) closeMenu();
  };

  const onDocumentKeyDown = (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    closeMenu();
    trigger.focus();
  };

  trigger.addEventListener("click", () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    trigger.setAttribute("aria-expanded", String(willOpen));
  });

  signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;
    try {
      await onSignOut();
    } catch (error) {
      signOutButton.disabled = false;
      console.error("[online-auth] Sign-out failed.", error);
    }
  });

  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);
  document.body.append(container);

  return {
    destroy() {
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
      container.remove();
    }
  };
}

function getAuthErrorMessage(error) {
  return AUTH_ERROR_MESSAGES[error?.code]
    || "Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}
