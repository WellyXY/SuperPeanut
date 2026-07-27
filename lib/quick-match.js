(function () {
  const LOCATION_GROUPS = [
    { id: "argentina", region: "south_america", terms: ["阿根廷", "argentina", "buenos aires"] },
    { id: "uruguay", region: "south_america", terms: ["乌拉圭", "uruguay"] },
    { id: "paraguay", region: "south_america", terms: ["巴拉圭", "paraguay"] },
    { id: "chile", region: "south_america", terms: ["智利", "chile"] },
    { id: "peru", region: "south_america", terms: ["秘鲁", "peru"] },
    { id: "brazil", region: "south_america", terms: ["巴西", "brazil"] },
    { id: "mexico", region: "north_america", terms: ["墨西哥", "mexico", "cdmx", "mexico city", "chihuahua", "durango", "guadalajara", "lazaro cardenas", "mexicali", "monterrey", "sonora", "zacatecas"] },
    { id: "usa", region: "north_america", terms: ["美国", "united states", "usa", "u.s.", "peachtree city"] },
    { id: "uk", region: "europe", terms: ["英国", "united kingdom", "england", "scotland", "wales", "london"] },
    { id: "ireland", region: "europe", terms: ["爱尔兰", "ireland"] },
    { id: "germany", region: "europe", terms: ["德国", "germany", "deutschland", "bedburg", "aichtal"] },
    { id: "italy", region: "europe", terms: ["意大利", "italy", "roma", "rome"] },
    { id: "france", region: "europe", terms: ["法国", "france"] },
    { id: "poland", region: "europe", terms: ["波兰", "poland"] },
    { id: "romania", region: "europe", terms: ["罗马尼亚", "romania", "craiova"] },
    { id: "hungary", region: "europe", terms: ["匈牙利", "hungary"] },
    { id: "greece", region: "europe", terms: ["希腊", "greece"] },
    { id: "finland", region: "europe", terms: ["芬兰", "finland"] },
    { id: "ukraine", region: "europe", terms: ["乌克兰", "ukraine", "kyiv", "kiev"] },
    { id: "netherlands", region: "europe", terms: ["荷兰", "netherlands", "holland"] },
    { id: "belgium", region: "europe", terms: ["比利时", "belgium"] },
    { id: "luxembourg", region: "europe", terms: ["卢森堡", "luxembourg"] },
    { id: "turkey", region: "europe", terms: ["土耳其", "turkey", "turkiye", "türkiye", "istanbul"] },
    { id: "south_africa", region: "africa", terms: ["南非", "south africa", "gauteng", "mpumalanga", "durban", "cape town", "kzn", "kwazulu-natal"] },
    { id: "nigeria", region: "africa", terms: ["尼日利亚", "nigeria"] },
    { id: "zambia", region: "africa", terms: ["赞比亚", "zambia"] },
    { id: "angola", region: "africa", terms: ["安哥拉", "angola"] },
    { id: "mozambique", region: "africa", terms: ["莫桑比克", "mozambique", "maputo"] },
    { id: "ghana", region: "africa", terms: ["加纳", "ghana"] },
    { id: "ivory_coast", region: "africa", terms: ["科特迪瓦", "ivory coast", "cote d ivoire"] },
    { id: "kenya", region: "africa", terms: ["肯尼亚", "kenya"] },
    { id: "tanzania", region: "africa", terms: ["坦桑尼亚", "tanzania"] },
    { id: "uganda", region: "africa", terms: ["乌干达", "uganda"] },
    { id: "ethiopia", region: "africa", terms: ["埃塞俄比亚", "埃塞", "ethiopia"] },
    { id: "drc", region: "africa", terms: ["刚果金", "democratic republic of the congo", "drc"] },
    { id: "cameroon", region: "africa", terms: ["喀麦隆", "cameroon"] },
    { id: "egypt", region: "africa", terms: ["埃及", "egypt", "cairo"] },
    { id: "algeria", region: "africa", terms: ["阿尔及利亚", "algeria"] },
    { id: "morocco", region: "africa", terms: ["摩洛哥", "morocco"] },
    { id: "tunisia", region: "africa", terms: ["突尼斯", "tunisia"] },
    { id: "burkina_faso", region: "africa", terms: ["布基纳法索", "burkina faso"] },
    { id: "gabon", region: "africa", terms: ["加蓬", "gabon"] },
    { id: "chad", region: "africa", terms: ["乍得", "chad"] },
    { id: "south_sudan", region: "africa", terms: ["南苏丹", "south sudan"] },
    { id: "saudi", region: "middle_east", terms: ["沙特", "saudi arabia"] },
    { id: "uae", region: "middle_east", terms: ["阿联酋", "united arab emirates", "uae", "dubai", "abu dhabi"] },
    { id: "indonesia", region: "asia", terms: ["印度尼西亚", "印尼", "indonesia"] },
    { id: "india", region: "asia", terms: ["印度", "india"] },
    { id: "malaysia", region: "asia", terms: ["马来西亚", "malaysia"] },
    { id: "thailand", region: "asia", terms: ["泰国", "thailand"] },
    { id: "philippines", region: "asia", terms: ["菲律宾", "philippines"] },
    { id: "cambodia", region: "asia", terms: ["柬埔寨", "cambodia"] },
    { id: "myanmar", region: "asia", terms: ["缅甸", "myanmar", "burma"] },
    { id: "japan", region: "asia", terms: ["日本", "japan"] },
    { id: "taiwan", region: "asia", terms: ["台湾", "taiwan"] },
    { id: "china", region: "asia", terms: ["中国", "china", "长沙", "changsha"] },
  ];

  const REGION_TERMS = {
    africa: ["非洲", "africa", "北非", "north africa", "西非", "west africa"],
    asia: ["亚洲", "asia", "东南亚", "southeast asia"],
    europe: ["欧洲", "europe", "西欧", "western europe", "东欧", "eastern europe", "北欧", "nordic"],
    north_america: ["北美", "north america"],
    south_america: ["南美", "south america", "拉美", "latin america"],
    middle_east: ["中东", "middle east"],
  };

  const FUNCTION_GROUPS = [
    { id: "sales", terms: ["sales", "marketing", "business development", "account manager", "commercial", "channel", "dealer", "distribution", "销售", "营销", "市场", "商务", "大客户", "渠道", "经销商"] },
    { id: "service", terms: ["aftersales", "after sales", "aftermarket", "field service", "service manager", "service technician", "parts", "售后", "服务", "配件"] },
    { id: "technical", terms: ["technical", "engineer", "engineering", "research and development", "r&d", "研发", "技术", "工程师"] },
    { id: "product", terms: ["product manager", "product management", "产品经理", "产品管理"] },
    { id: "project", terms: ["project manager", "program manager", "项目经理", "项目管理"] },
    { id: "finance", terms: ["finance", "financial", "controller", "accounting", "财务", "会计"] },
    { id: "hr", terms: ["human resources", "talent acquisition", "recruiter", "hr", "人力资源", "招聘"] },
    { id: "legal", terms: ["legal", "lawyer", "counsel", "compliance", "法务", "律师", "合规"] },
    { id: "managing", terms: ["country manager", "general manager", "managing director", "chief executive", "总经理", "国家经理", "负责人"] },
  ];

  const PRODUCT_GROUPS = [
    { id: "excavator", terms: ["excavator", "earthmoving", "挖机", "挖掘机", "土方机械"] },
    { id: "mining", terms: ["mining", "mine", "矿业", "矿山", "矿用"] },
    { id: "port", terms: ["port machinery", "container handling", "reach stacker", "heavy forklift", "港机", "正面吊", "堆高机", "重叉"] },
    { id: "loader", terms: ["wheel loader", "loader", "装载机"] },
    { id: "crane", terms: ["crane", "lifting", "hoisting", "起重机", "吊装"] },
    { id: "truck", terms: ["heavy truck", "electric truck", "commercial vehicle", "重卡", "卡车", "商用车"] },
    { id: "road", terms: ["road machinery", "paving", "paver", "compactor", "roller", "asphalt", "ammann", "bomag", "wirtgen", "dynapac", "vögele", "vogele", "路机", "摊铺", "压路机", "沥青"] },
    { id: "concrete", terms: ["concrete", "batching plant", "mixer truck", "pump truck", "混凝土", "搅拌站", "泵车"] },
    { id: "fire", terms: ["fire truck", "firefighting", "aerial ladder", "消防车", "云梯"] },
    { id: "solar", terms: ["solar", "photovoltaic", "microgrid", "光伏", "微电网"] },
    { id: "robot", terms: ["robot", "robotics", "automation", "机器人", "自动化"] },
  ];

  const GENERIC_MACHINERY = ["construction equipment", "heavy equipment", "heavy machinery", "construction machinery", "工程机械", "重型设备"];
  const STOP_WORDS = new Set(["and", "the", "for", "with", "from", "this", "that", "manager", "senior", "lead", "head", "years", "year", "current", "present", "global", "regional", "role", "岗位", "经理", "高级", "负责", "要求", "经验"]);

  const normalize = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[‐‑‒–—]/g, "-").replace(/[^\p{L}\p{N}.&+/-]+/gu, " ").replace(/\s+/g, " ").trim();
  const termPattern = (term) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  const hasTerm = (text, term) => /[\u3400-\u9fff]/u.test(term) ? text.includes(term) : termPattern(normalize(term)).test(text);
  const containsAny = (text, terms) => terms.some((term) => hasTerm(text, term));

  function locationGroups(value) {
    const text = normalize(value);
    const matches = [];
    const occupied = [];
    const terms = LOCATION_GROUPS.flatMap((group) => group.terms.map((term) => ({ group, term: normalize(term) }))).sort((a, b) => b.term.length - a.term.length);
    for (const entry of terms) {
      let start = text.indexOf(entry.term);
      while (start >= 0) {
        const end = start + entry.term.length;
        const bounded = /[\u3400-\u9fff]/u.test(entry.term) || termPattern(entry.term).test(text);
        const overlaps = occupied.some((span) => start < span.end && end > span.start);
        if (bounded && !overlaps) {
          matches.push(entry.group);
          occupied.push({ start, end });
          break;
        }
        start = text.indexOf(entry.term, start + 1);
      }
    }
    return [...new Map(matches.map((group) => [group.id, group])).values()];
  }

  function locationFit(candidateLocation, roleText) {
    const candidateText = normalize(candidateLocation);
    if (!candidateText) return 0;
    const roleLocationText = normalize(roleText);
    const candidateGroups = locationGroups(candidateText);
    const roleGroups = locationGroups(roleLocationText);
    if (candidateGroups.some((candidate) => roleGroups.some((role) => role.id === candidate.id))) return 1;
    if (roleGroups.length) return 0;

    const directTokens = candidateText.split(" ").filter((token) => token.length >= 4 && !["city", "state", "province", "region", "greater", "area"].includes(token));
    if (directTokens.some((token) => hasTerm(roleLocationText, token))) return 1;

    const candidateRegions = new Set(candidateGroups.map((group) => group.region));
    for (const [region, terms] of Object.entries(REGION_TERMS)) {
      if (candidateRegions.has(region) && containsAny(roleLocationText, terms)) return 0.82;
    }
    return 0;
  }

  const groupsFor = (text, groups) => groups.filter((group) => containsAny(text, group.terms)).map((group) => group.id);
  const intersection = (left, right) => left.some((item) => right.includes(item));

  function functionGroupsFor(text) {
    const withoutAfterSales = normalize(text).replace(/\bafter\s*sales\b/g, " ").replace(/\baftersales\b/g, " ");
    return FUNCTION_GROUPS.filter((group) => containsAny(group.id === "sales" ? withoutAfterSales : text, group.terms)).map((group) => group.id);
  }

  function functionFit(candidateText, roleText) {
    const candidateGroups = functionGroupsFor(candidateText);
    const roleGroups = functionGroupsFor(roleText);
    if (candidateGroups.length && roleGroups.length) return intersection(candidateGroups, roleGroups) ? 1 : 0;
    return 0.45;
  }

  function productFit(candidateText, roleText) {
    const candidateGroups = groupsFor(candidateText, PRODUCT_GROUPS);
    const roleGroups = groupsFor(roleText, PRODUCT_GROUPS);
    if (intersection(candidateGroups, roleGroups)) return 1;
    if (!roleGroups.length) {
      return candidateGroups.length || containsAny(candidateText, GENERIC_MACHINERY) ? 0.65 : 0.25;
    }
    if (candidateGroups.length && roleGroups.length) return -1;
    if (containsAny(candidateText, GENERIC_MACHINERY)) return 0.5;
    return 0;
  }

  function seniorityFit(candidateText, roleText) {
    const levels = [
      ["chief", "vice president", "vp", "director", "总监", "副总裁"],
      ["manager", "head", "lead", "经理", "负责人"],
      ["specialist", "engineer", "consultant", "technician", "专员", "工程师", "技师"],
    ];
    const rank = (text) => levels.findIndex((terms) => containsAny(text, terms));
    const candidateRank = rank(candidateText);
    const roleRank = rank(roleText);
    if (candidateRank < 0 || roleRank < 0) return 0.5;
    const difference = Math.abs(candidateRank - roleRank);
    return difference === 0 ? 1 : difference === 1 ? 0.65 : 0.2;
  }

  function lexicalFit(candidateText, roleText) {
    const tokens = (text) => new Set(normalize(text).split(" ").filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
    const candidateTokens = tokens(candidateText);
    const roleTokens = tokens(roleText);
    if (!candidateTokens.size || !roleTokens.size) return 0;
    const overlap = [...candidateTokens].filter((token) => roleTokens.has(token)).length;
    return Math.min(1, overlap / Math.max(2, Math.min(candidateTokens.size, roleTokens.size)));
  }

  function matchCandidateToRoles(candidate, roles) {
    const candidateText = normalize([candidate.name, candidate.headline, candidate.description].join(" "));
    const candidates = [];
    for (const role of Array.isArray(roles) ? roles : []) {
      if (!role || Number(role.openCount ?? 1) <= 0) continue;
      const roleText = normalize([role.title, role.businessUnit, role.function, role.location, role.region, role.note].join(" "));
      const location = locationFit(candidate.location, `${role.location || ""} ${role.region || ""} ${role.note || ""}`);
      if (!location) continue;
      const functional = functionFit(candidateText, roleText);
      const product = productFit(candidateText, roleText);
      if (!functional || product < 0) continue;
      const seniority = seniorityFit(candidateText, roleText);
      const lexical = lexicalFit(candidateText, roleText);
      const priority = { SSS: 5, SS: 3, S: 1 }[String(role.priority || "S").toUpperCase()] || 0;
      const score = Math.min(98, Math.round(location * 30 + functional * 25 + product * 25 + seniority * 10 + lexical * 5 + priority));
      candidates.push({ roleId: role.id, roleTitle: role.title || "未命名岗位", score, locationFit: location, functionalFit: functional, productFit: product });
    }
    return candidates.sort((left, right) => right.score - left.score)[0] || null;
  }

  function candidateFromSearchText(name, paragraphs) {
    const values = (Array.isArray(paragraphs) ? paragraphs : []).map((value) => String(value || "").trim()).filter(Boolean);
    return {
      name: String(name || "").trim() || values[0]?.replace(/\s*[•·]\s*\d+(?:st|nd|rd|th|\+).*$/i, "").trim() || "候选人",
      headline: values[1] || "",
      location: values[2] || "",
      description: values.slice(3).join(" "),
    };
  }

  const isPeopleSearchPath = (pathname) => /^\/search\/results\/people(?:\/|$)/.test(String(pathname || ""));

  globalThis.SuperPeanutQuickMatch = { candidateFromSearchText, isPeopleSearchPath, matchCandidateToRoles };
})();
