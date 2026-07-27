import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadMatcher() {
  const context = { globalThis: {} };
  vm.createContext(context);
  vm.runInContext(await readFile(new URL("../lib/quick-match.js", import.meta.url), "utf8"), context);
  return context.globalThis.SuperPeanutQuickMatch;
}

const baseRole = {
  priority: "SS",
  businessUnit: "不限产品",
  function: "Sales & Marketing",
  openCount: 1,
  region: "",
  note: "",
};

test("recognizes LinkedIn people search paths only", async () => {
  const matcher = await loadMatcher();
  assert.equal(matcher.isPeopleSearchPath("/search/results/people/"), true);
  assert.equal(matcher.isPeopleSearchPath("/search/results/people/custom"), true);
  assert.equal(matcher.isPeopleSearchPath("/search/results/companies/"), false);
  assert.equal(matcher.isPeopleSearchPath("/in/someone/"), false);
});

test("parses the visible LinkedIn result fields", async () => {
  const matcher = await loadMatcher();
  const candidate = matcher.candidateFromSearchText("Gustavo Perez", [
      "Gustavo Perez • 2nd",
      "Area Sales Manager at Ammann Group",
      "Buenos Aires, Argentina",
      "Road machinery and paving sales since 2018.",
    ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(candidate)),
    {
      name: "Gustavo Perez",
      headline: "Area Sales Manager at Ammann Group",
      location: "Buenos Aires, Argentina",
      description: "Road machinery and paving sales since 2018.",
    },
  );
});

test("selects the matching country, function, and product line", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Gustavo", headline: "Area Sales Manager", location: "Argentina", description: "Road machinery and paving sales" },
    [
      { ...baseRole, id: "ar-road", title: "路机销售经理", location: "阿根廷", note: "路机与摊铺设备销售" },
      { ...baseRole, id: "br-road", title: "路机销售经理", location: "巴西", note: "路机与摊铺设备销售" },
    ],
  );
  assert.equal(result.roleId, "ar-road");
  assert.ok(result.score >= 80);
});

test("recognizes a road machinery brand when the search result omits product details", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Gustavo Ciapanna", headline: "Area Sales Manager Southern Cone en Ammann Group", location: "Argentina", description: "" },
    [{ ...baseRole, id: "ar-road", title: "Sales Manager (混凝土+路机)", location: "阿根廷", note: "路机销售" }],
  );
  assert.equal(result.roleId, "ar-road");
  assert.ok(result.score >= 80);
});

test("keeps a likely match when product evidence is absent on the search page", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Lucia", headline: "Regional Sales Manager", location: "Argentina", description: "" },
    [{ ...baseRole, id: "ar-road", title: "路机销售经理", location: "阿根廷", note: "路机销售" }],
  );
  assert.equal(result.roleId, "ar-road");
  assert.ok(result.score >= 62);
});

test("rejects an explicitly conflicting product line", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Lucia", headline: "Mining Equipment Sales Manager", location: "Argentina", description: "Mining trucks" },
    [{ ...baseRole, id: "ar-road", title: "路机销售经理", location: "阿根廷", note: "路机销售" }],
  );
  assert.equal(result, null);
});

test("does not let a broad region override an explicit different country", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Khaled", headline: "Mining Sales Manager", location: "Cairo, Egypt", description: "Mining equipment sales" },
    [{ ...baseRole, id: "nigeria", title: "矿业销售经理", location: "尼日利亚", region: "非洲区", businessUnit: "矿业设备" }],
  );
  assert.equal(result, null);
});

test("allows regional location only when the role has no explicit country", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Khaled", headline: "Mining Sales Manager", location: "Cairo, Egypt", description: "Mining equipment sales" },
    [{ ...baseRole, id: "north-africa", title: "矿业销售经理", location: "北非", region: "非洲区", businessUnit: "矿业设备" }],
  );
  assert.equal(result.roleId, "north-africa");
});

test("keeps India and Indonesia separate", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Sahil", headline: "Wheel Loader Sales Manager", location: "New Delhi, India", description: "Construction equipment dealer sales" },
    [
      { ...baseRole, id: "indonesia", title: "装载机销售经理", location: "印度尼西亚", businessUnit: "装载机" },
      { ...baseRole, id: "india", title: "装载机销售经理", location: "印度", businessUnit: "装载机" },
    ],
  );
  assert.equal(result.roleId, "india");
});

test("does not treat aftersales as direct sales", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Adi", headline: "After Sales Service Manager", location: "Indonesia", description: "Wheel loader field service and spare parts" },
    [{ ...baseRole, id: "sales", title: "装载机销售经理", location: "印度尼西亚", businessUnit: "装载机" }],
  );
  assert.equal(result, null);
});

test("ignores closed roles", async () => {
  const matcher = await loadMatcher();
  const result = matcher.matchCandidateToRoles(
    { name: "Gustavo", headline: "Road Machinery Sales Manager", location: "Argentina", description: "Paving sales" },
    [{ ...baseRole, id: "closed", title: "路机销售经理", location: "阿根廷", note: "路机销售", openCount: 0 }],
  );
  assert.equal(result, null);
});
