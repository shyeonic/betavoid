export const ko = {
  ui: {
    settings: {
      language: "언어",
      languageHint: "변경하면 화면을 다시 불러옵니다",
      languages: {
        en: "영어",
        ko: "한국어"
      }
    },
    scanner: {
      categories: {
        buildings: "건물",
        resources: "자원"
      },
      empty: "감지된 객체 없음",
      detail: "상세",
      autoNavigate: "자동 항법",
      objectDetail: "객체 상세",
      closeDetail: "상세 닫기",
      fields: {
        amount: "수량",
        category: "분류",
        chunk: "청크",
        chunkRelative: "청크 상대 좌표",
        distance: "거리",
        hp: "HP",
        name: "이름",
        position: "좌표",
        sector: "섹터",
        status: "상태",
        type: "유형"
      }
    }
  },
  item: {
    item_001: { name: "하이드라이트", description: "수소광물 자원" },
    item_002: { name: "티타늄", description: "광물 자원" },
    item_003: { name: "구리", description: "광물 자원" },
    item_004: { name: "철", description: "광물 자원" },
    item_005: { name: "금", description: "광물 자원" },
    item_006: { name: "실리콘", description: "광물 자원" },
    item_007: { name: "수소", description: "가스 자원" },
    item_008: { name: "헬륨", description: "가스 자원" },
    item_009: { name: "제논", description: "가스 자원" },
    item_010: { name: "탈리스", description: "가스 자원" }
  },
  resource: {
    rss_001: { name: "하이드라이트 매장지", description: "하이드라이트를 생산하는 자원 노드" },
    rss_002: { name: "티타늄 매장지", description: "티타늄을 생산하는 자원 노드" },
    rss_003: { name: "구리 매장지", description: "구리를 생산하는 자원 노드" },
    rss_004: { name: "철 매장지", description: "철을 생산하는 자원 노드" },
    rss_005: { name: "금 매장지", description: "금을 생산하는 자원 노드" },
    rss_006: { name: "실리콘 매장지", description: "실리콘을 생산하는 자원 노드" },
    rss_007: { name: "수소 가스전", description: "수소를 생산하는 소멸형 가스 노드" },
    rss_008: { name: "헬륨 가스전", description: "헬륨을 생산하는 소멸형 가스 노드" },
    rss_009: { name: "제논 가스전", description: "제논을 생산하는 소멸형 가스 노드" },
    rss_010: { name: "탈리스 가스전", description: "탈리스를 생산하는 소멸형 가스 노드" }
  },
  building: {
    arc_station: { name: "아크 스테이션", description: "인구, 정박, 창고, 방어, 전력, 생존 자원을 지원하는 핵심 스테이션" },
    plasma_power_plant: { name: "플라즈마 파워 플랜트", description: "전기를 생산하는 시설" },
    beta_particle_reactor: { name: "베타 입자 리액터", description: "하이퍼드라이브 에너지를 생산하는 시설" },
    orbital_dorm: { name: "궤도 거주지", description: "인구와 노동자를 제공하는 거주 시설" },
    colony_dorm: { name: "외곽 거주지", description: "외곽 지역에 인구와 노동자를 제공하는 거주 시설" },
    orbital_defence_turret: { name: "궤도 방어 터렛", description: "적대적 함선을 공격하는 방어 터렛" },
    sentinel_turret: { name: "감시 터렛", description: "적대적 함선을 공격하는 소형 방어 터렛" },
    shipyard: { name: "조선소", description: "함선을 건조하고 수리하는 대형 도크 시설" },
    trade_port: { name: "무역항", description: "외부 함선이 정박하여 물자를 거래하는 경제 허브" },
    outbase: { name: "아웃베이스", description: "섹터 확장을 위한 다목적 전초기지" },
    hydro_synthesizer: { name: "수자원 합성소", description: "수소 합성과 폐수 재활용을 담당하는 정수 시설" },
    mine: { name: "광산", description: "유용 광물을 채굴하는 산업 시설" },
    refinery: { name: "정제소", description: "고에너지 기체를 추출하고 정제하는 시설" },
    bio_fab: { name: "바이오 팹", description: "유기 자원을 생산하는 생물 공정 시설" },
    food_factory: { name: "식품 공장", description: "생물 자원을 식품으로 가공하는 공장" },
    silicon_factory: { name: "반도체 공장", description: "정제 광물로 반도체를 생산하는 공장" },
    weapon_factory: { name: "무기 공장", description: "표준 함선 무기 체계를 생산하는 공장" },
    advanced_weapon_factory: { name: "특수 무기 공장", description: "실험적 프로토타입과 특수 병기를 생산하는 공장" }
  },
  buildingSize: {
    EX: "전용",
    L: "대형",
    M: "중형",
    S: "소형"
  },
  buildingCategory: {
    defense_turret: "방어 포탑",
    factory: "공장",
    habitation: "거주 시설",
    headquarters: "헤드쿼터",
    hyperdrive_energy: "하이퍼드라이브 에너지 생산 시설",
    outpost: "전초기지",
    power_plant: "발전소",
    resource_production: "자원 생산 시설",
    shipyard: "조선소",
    trade_port: "거래소"
  },
  sector: {
    "SEC-001": { name: "엡실론 프라임", theme: "화산 산업지대" },
    "SEC-002": { name: "노바 스테이션", theme: "무역 허브" },
    "SEC-003": { name: "크림슨 익스팬스", theme: "사막 황무지" },
    "SEC-004": { name: "애저 네뷸라", theme: "가스 행성권" },
    "SEC-005": { name: "옵시디언 리치", theme: "암흑 물질 지대" },
    "SEC-006": { name: "타이탄 게이트", theme: "군사 요새" },
    "SEC-007": { name: "헬리오스 코어", theme: "태양 제련소" },
    "SEC-008": { name: "프로스트 프론티어", theme: "얼음 세계" },
    "SEC-009": { name: "에메랄드 헤이븐", theme: "농업 낙원" },
    "SEC-010": { name: "보이드 엣지", theme: "개척 전초지" }
  }
};
