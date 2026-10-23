// A.3 layout spike: builds the worked example layout of the fab0 rebuild in
// fab0-sandbox, signed in as the fab0 App. Every write checks first, as `sync`
// will, so a second run makes no write. Run: FAB0_APP_KEY_PATH=... bun layout.ts
import { installation, ORG } from "./auth";

const gh = await installation();
const RUN = 1;
const PROJECT_TITLE = "fab0 sandbox factory";
const BRANCH = `fab0/${RUN}/backend-spec`;

let writes = 0;
async function write<T>(what: string, fn: () => Promise<T>): Promise<T> {
  writes++;
  console.log(`write  ${what}`);
  return fn();
}
const ok = (what: string) => console.log(`ok     ${what}`);

// 1. Issue types --------------------------------------------------------------

const TYPES = [
  { name: "Story", color: "purple", description: "A change a person asks for; the root of a run" },
  { name: "Requirement", color: "blue", description: "What a Story must make true" },
  { name: "Task", color: "yellow", description: "One pull request's worth of work" },
];

const { data: types } = await gh.request("GET /orgs/{org}/issue-types", { org: ORG });
for (const t of TYPES) {
  const found = types.find((x: any) => x.name === t.name);
  if (found) ok(`issue type ${t.name} (${found.id})`);
  else await write(`issue type ${t.name}`, () => gh.request("POST /orgs/{org}/issue-types", { org: ORG, ...t, is_enabled: true }));
}

// 2. Project and its fields ---------------------------------------------------

type Opt = { name: string; color: string; description: string };
const opt = (name: string, color: string, description = ""): Opt => ({ name, color, description });

const STAGES: Opt[] = [
  opt("Queued", "GRAY", "Eligible, waiting for a runner"),
  opt("Running", "BLUE", "An attempt is running"),
  opt("In review", "YELLOW", "Made, waiting for its approval"),
  opt("Waiting", "ORANGE", "Waiting on a person"),
  opt("Approved", "GREEN", "Approved; final"),
  opt("Rejected", "RED", "Rejected; final"),
  opt("Skipped", "GRAY", "Its if did not hold; final"),
  opt("Cancelled", "GRAY", "Cancelled by a person"),
  opt("Paused", "PURPLE", "Paused by a person"),
  opt("Done", "GREEN", "The run is done"),
  opt("Failed", "RED", "Out of retries"),
  opt("Stuck", "PINK", "Lease lost or no runner"),
];

const FIELDS: { name: string; type: "SINGLE_SELECT" | "NUMBER" | "TEXT"; options?: Opt[] }[] = [
  { name: "Stage", type: "SINGLE_SELECT", options: STAGES },
  { name: "Run", type: "NUMBER" },
  { name: "Revision", type: "NUMBER" },
  { name: "Duration", type: "NUMBER" },
  { name: "Tokens", type: "NUMBER" },
  { name: "Cost", type: "NUMBER" },
  { name: "Step", type: "TEXT" },
  { name: "Waiting on", type: "TEXT" },
  { name: "Session", type: "TEXT" },
  { name: "Runner", type: "SINGLE_SELECT", options: [opt("cloud", "BLUE"), opt("laptop", "GREEN")] },
  { name: "Flow", type: "SINGLE_SELECT", options: [opt("coding", "BLUE")] },
];

const FIELDS_FRAGMENT = `
  fields(first: 50) { nodes {
    ... on ProjectV2FieldCommon { id name dataType }
    ... on ProjectV2SingleSelectField { options { id name color description } }
  } }`;

const { organization: org } = await gh.graphql<any>(
  `query($org: String!, $q: String!) { organization(login: $org) { id
     projectsV2(first: 20, query: $q) { nodes { id number title ${FIELDS_FRAGMENT}
       repositories(first: 10) { nodes { name } }
       views(first: 20) { nodes { id name layout filter } } } } } }`,
  { org: ORG, q: PROJECT_TITLE },
);
let project = org.projectsV2.nodes.find((p: any) => p.title === PROJECT_TITLE);
if (project) ok(`project #${project.number} ${project.title}`);
else {
  const r = await write(`project ${PROJECT_TITLE}`, () =>
    gh.graphql<any>(
      `mutation($owner: ID!, $title: String!) { createProjectV2(input: {ownerId: $owner, title: $title}) {
         projectV2 { id number title ${FIELDS_FRAGMENT} repositories(first: 10) { nodes { name } }
           views(first: 20) { nodes { id name layout filter } } } } }`,
      { owner: org.id, title: PROJECT_TITLE },
    ),
  );
  project = r.createProjectV2.projectV2;
}

if (project.repositories.nodes.some((r: any) => r.name === "factory")) ok("project linked to factory");
else {
  const { repository } = await gh.graphql<any>(`query($o: String!) { repository(owner: $o, name: "factory") { id } }`, { o: ORG });
  await write("link project to factory", () =>
    gh.graphql(`mutation($p: ID!, $r: ID!) { linkProjectV2ToRepository(input: {projectId: $p, repositoryId: $r}) { clientMutationId } }`, {
      p: project.id,
      r: repository.id,
    }),
  );
}

const fields: Record<string, any> = {};
for (const f of FIELDS) {
  let field = project.fields.nodes.find((x: any) => x.name === f.name);
  if (field && field.dataType !== f.type) throw new Error(`field ${f.name} is ${field.dataType}, want ${f.type}`);
  if (!field) {
    const r = await write(`field ${f.name} (${f.type}${f.options ? `, ${f.options.length} options` : ""})`, () =>
      gh.graphql<any>(
        `mutation($p: ID!, $n: String!, $t: ProjectV2CustomFieldType!, $o: [ProjectV2SingleSelectFieldOptionInput!]) {
           createProjectV2Field(input: {projectId: $p, name: $n, dataType: $t, singleSelectOptions: $o}) {
             projectV2Field { ... on ProjectV2FieldCommon { id name dataType }
               ... on ProjectV2SingleSelectField { options { id name color description } } } } }`,
        { p: project.id, n: f.name, t: f.type, o: f.options ?? null },
      ),
    );
    field = r.createProjectV2Field.projectV2Field;
  } else if (f.options) {
    const missing = f.options.filter((o) => !field.options.some((x: any) => x.name === o.name));
    if (missing.length) {
      // Keep each existing option's id, so item values survive; add the missing ones.
      const all = [...field.options.map((x: any) => ({ id: x.id, name: x.name, color: x.color, description: x.description })), ...missing];
      const r = await write(`field ${f.name}: add options ${missing.map((o) => o.name).join(", ")}`, () =>
        gh.graphql<any>(
          `mutation($f: ID!, $o: [ProjectV2SingleSelectFieldOptionInput!]) {
             updateProjectV2Field(input: {fieldId: $f, singleSelectOptions: $o}) {
               projectV2Field { ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } } } }`,
          { f: field.id, o: all },
        ),
      );
      field = r.updateProjectV2Field.projectV2Field;
    } else ok(`field ${f.name} (${field.options.length} options)`);
  } else ok(`field ${f.name}`);
  fields[f.name] = field;
}

// 3. Story 1 and Requirement 2 ------------------------------------------------

async function issue(title: string, type: string, body: string) {
  const { data } = await gh.request("GET /repos/{owner}/{repo}/issues", { owner: ORG, repo: "factory", state: "all", per_page: 100 });
  const found = data.find((i: any) => i.title === title && !i.pull_request);
  if (found) {
    ok(`issue factory#${found.number} ${title}`);
    if (found.type?.name !== type) throw new Error(`factory#${found.number} has type ${found.type?.name}, want ${type}`);
    return found;
  }
  const { data: made } = await write(`issue ${type}: ${title}`, () =>
    gh.request("POST /repos/{owner}/{repo}/issues", { owner: ORG, repo: "factory", title, body, type }),
  );
  return made;
}

const story = await issue("Sandbox Story: per-user rate limits", "Story", "Worked example root item. Run 1 of the A.3 layout spike.");
const requirement = await issue("Requirement: per-user rate limits", "Requirement", "Made by the `requirement` step of run 1.");

const { data: subs } = await gh.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
  owner: ORG,
  repo: "factory",
  issue_number: story.number,
});
if (subs.some((s: any) => s.id === requirement.id)) ok(`factory#${requirement.number} is a sub-issue of factory#${story.number}`);
else
  await write(`sub-issue factory#${requirement.number} under factory#${story.number}`, () =>
    gh.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
      owner: ORG,
      repo: "factory",
      issue_number: story.number,
      sub_issue_id: requirement.id,
    }),
  );

// 4. Draft PR in backend on an empty commit -----------------------------------

const { data: prs } = await gh.request("GET /repos/{owner}/{repo}/pulls", { owner: ORG, repo: "backend", state: "all", head: `${ORG}:${BRANCH}` });
let pr = prs[0];
if (pr) ok(`pr backend#${pr.number} from ${BRANCH} (draft: ${pr.draft})`);
else {
  let head: string;
  try {
    const { data: ref } = await gh.request("GET /repos/{owner}/{repo}/git/ref/{ref}", { owner: ORG, repo: "backend", ref: `heads/${BRANCH}` });
    head = ref.object.sha;
    ok(`branch ${BRANCH}`);
  } catch (e: any) {
    if (e.status !== 404) throw e;
    const { data: main } = await gh.request("GET /repos/{owner}/{repo}/commits/{ref}", { owner: ORG, repo: "backend", ref: "main" });
    const { data: commit } = await write(`empty commit on main's tree`, () =>
      gh.request("POST /repos/{owner}/{repo}/git/commits", {
        owner: ORG,
        repo: "backend",
        message: `fab0: start backend-spec of run ${RUN}`,
        tree: main.commit.tree.sha,
        parents: [main.sha],
      }),
    );
    await write(`branch ${BRANCH}`, () =>
      gh.request("POST /repos/{owner}/{repo}/git/refs", { owner: ORG, repo: "backend", ref: `refs/heads/${BRANCH}`, sha: commit.sha }),
    );
    head = commit.sha;
  }
  const { data: made } = await write(`draft pr from ${BRANCH} (${head.slice(0, 7)})`, () =>
    gh.request("POST /repos/{owner}/{repo}/pulls", {
      owner: ORG,
      repo: "backend",
      title: `backend-spec: run ${RUN}`,
      head: BRANCH,
      base: "main",
      draft: true,
      body: `Step \`backend-spec\` of run ${RUN} (${ORG}/factory#${story.number}). Opened on an empty commit, before the session writes the spec.`,
    }),
  );
  pr = made;
}

// Project items and their field values ----------------------------------------

async function item(nodeId: string, label: string, values: Record<string, string | number>) {
  const { node } = await gh.graphql<any>(
    `query($id: ID!) { node(id: $id) { ... on Issue { projectItems(first: 10) { nodes { id project { id }
         fieldValues(first: 30) { nodes {
           ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
           ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
           ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } }
       ... on PullRequest { projectItems(first: 10) { nodes { id project { id }
         fieldValues(first: 30) { nodes {
           ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
           ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
           ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`,
    { id: nodeId },
  );
  let it = node.projectItems.nodes.find((n: any) => n.project.id === project.id);
  if (it) ok(`${label} on the project`);
  else {
    const r = await write(`add ${label} to the project`, () =>
      gh.graphql<any>(`mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: {projectId: $p, contentId: $c}) { item { id } } }`, {
        p: project.id,
        c: nodeId,
      }),
    );
    it = { id: r.addProjectV2ItemById.item.id, fieldValues: { nodes: [] } };
  }
  const current: Record<string, unknown> = {};
  for (const v of it.fieldValues.nodes) if (v.field) current[v.field.name] = v.text ?? v.number ?? v.name;
  for (const [name, want] of Object.entries(values)) {
    if (current[name] === want) continue;
    const f = fields[name];
    let value: Record<string, unknown>;
    if (f.dataType === "NUMBER") value = { number: want };
    else if (f.dataType === "TEXT") value = { text: want };
    else {
      const o = f.options.find((x: any) => x.name === want);
      if (!o) throw new Error(`${name} has no option ${want}`);
      value = { singleSelectOptionId: o.id };
    }
    await write(`${label}: ${name} = ${want}`, () =>
      gh.graphql(
        `mutation($p: ID!, $i: ID!, $f: ID!, $v: ProjectV2FieldValue!) {
           updateProjectV2ItemFieldValue(input: {projectId: $p, itemId: $i, fieldId: $f, value: $v}) { projectV2Item { id } } }`,
        { p: project.id, i: it.id, f: f.id, v: value },
      ),
    );
  }
  if (Object.entries(values).every(([k, v]) => current[k] === v)) ok(`${label} fields`);
}

await item(story.node_id, `factory#${story.number}`, { Stage: "Running", Run: RUN, Flow: "coding" });
await item(requirement.node_id, `factory#${requirement.number}`, {
  Stage: "In review",
  Run: RUN,
  Step: "requirement",
  Revision: 1,
  Runner: "cloud",
  "Waiting on": "po",
  Duration: 312,
  Tokens: 48210,
  Cost: 0.41,
  Flow: "coding",
});
await item(pr.node_id, `backend#${pr.number}`, {
  Stage: "Running",
  Run: RUN,
  Step: "backend-spec",
  Revision: 1,
  Runner: "cloud",
  Session: "https://claude.ai/code/session_spike",
  Flow: "coding",
});

// 5. Project views ------------------------------------------------------------

const VIEWS = [
  { name: "Run 1", layout: "TABLE_LAYOUT", filter: `run:${RUN}`, visible: ["Title", "Stage", "Step", "Revision", "Waiting on", "Runner", "Session"] },
  { name: "Stages", layout: "BOARD_LAYOUT", filter: "", visible: ["Title", "Stage", "Run", "Step"] },
];
const { node: withViews } = await gh.graphql<any>(
  `query($id: ID!) { node(id: $id) { ... on ProjectV2 { views(first: 20) { nodes { id name layout filter } }
     fields(first: 50) { nodes { ... on ProjectV2FieldCommon { id name } } } } } }`,
  { id: project.id },
);
for (const v of VIEWS) {
  let view = withViews.views.nodes.find((x: any) => x.name === v.name);
  if (!view) {
    const visibleFieldIds = v.visible.map((n) => withViews.fields.nodes.find((f: any) => f.name === n)?.id).filter(Boolean);
    const r = await write(`view ${v.name} (${v.layout})`, () =>
      gh.graphql<any>(
        `mutation($p: ID!, $n: String!, $l: ProjectV2ViewLayout!, $c: ProjectV2ViewConfigurationInput) {
           createProjectV2View(input: {projectId: $p, name: $n, layout: $l, configuration: $c}) { projectV2View { id name layout filter } } }`,
        { p: project.id, n: v.name, l: v.layout, c: { visibleFieldIds } },
      ),
    );
    view = r.createProjectV2View.projectV2View;
  } else ok(`view ${v.name} (${view.layout})`);
  if ((view.filter ?? "") !== v.filter)
    await write(`view ${v.name}: filter "${v.filter}"`, () =>
      gh.graphql(`mutation($v: ID!, $f: String!) { updateProjectV2View(input: {viewId: $v, filter: $f}) { projectV2View { id } } }`, {
        v: view.id,
        f: v.filter,
      }),
    );
}

console.log(`\nproject: https://github.com/orgs/${ORG}/projects/${project.number}`);
console.log(`story:   ${story.html_url}\npr:      ${pr.html_url}`);
console.log(`writes:  ${writes}`);
