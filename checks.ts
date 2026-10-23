// A.3 checks, as the fab0 App. Run: FAB0_APP_KEY_PATH=... bun checks.ts <command>
//   deliveries [n] [event]   the App's latest webhook deliveries (JWT: GET /app/hook/deliveries)
//   delivery <id>            one delivery's event, action and the payload fields A.3 asks about
//   approve <repo> <pr>      post an approving review on a PR, then read the PR's review decision
//   snapshot [run]           one snapshot query of a run, with its rateLimit cost
import { app, installation, ORG } from "./auth";

const [cmd, ...args] = process.argv.slice(2);

// Delivery ids pass 2^53, so JSON.parse would round them: read them as strings.
async function appGet(path: string): Promise<any> {
  const { token } = (await app().octokit.auth({ type: "app" })) as { token: string };
  const res = await fetch(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return JSON.parse((await res.text()).replace(/"id":(\d{16,})/g, '"id":"$1"'));
}

if (cmd === "deliveries") {
  const n = Number(args[0] ?? 30);
  const data = await appGet("/app/hook/deliveries?per_page=100");
  const rows = data.filter((d: any) => !args[1] || d.event === args[1]).slice(0, n);
  for (const d of rows) console.log(`${d.id}  ${d.delivered_at}  ${d.status_code}  ${d.event}${d.action ? `.${d.action}` : ""}`);
} else if (cmd === "delivery") {
  const data = await appGet(`/app/hook/deliveries/${args[0]}`);
  const p: any = data.request.payload;
  console.log(
    JSON.stringify(
      {
        id: data.id,
        guid: data.guid,
        delivered_at: data.delivered_at,
        event: data.event,
        action: data.action,
        sender: p.sender?.login,
        repository: p.repository?.full_name,
        issue: p.issue && { number: p.issue.number, title: p.issue.title, type: p.issue.type?.name },
        sub_issue: p.sub_issue && { number: p.sub_issue.number, title: p.sub_issue.title },
        parent_issue: p.parent_issue && { number: p.parent_issue.number },
        projects_v2_item: p.projects_v2_item && {
          node_id: p.projects_v2_item.node_id,
          content_node_id: p.projects_v2_item.content_node_id,
          content_type: p.projects_v2_item.content_type,
          project_node_id: p.projects_v2_item.project_node_id,
        },
        changes: p.changes,
        review: p.review && { state: p.review.state, user: p.review.user?.login },
        payload_keys: Object.keys(p),
      },
      null,
      2,
    ),
  );
} else if (cmd === "approve") {
  const gh = await installation();
  const [repo, number] = [args[0], Number(args[1])];
  const { data: review } = await gh.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
    owner: ORG,
    repo,
    pull_number: number,
    event: "APPROVE",
    body: "Approved by the `review` step's verdict (A.3 spike: the App posts a reviewer's verdict as a review, D135).",
  });
  console.log(`review ${review.id}: ${review.state} by ${review.user?.login}  ${review.html_url}`);
  const { repository } = await gh.graphql<any>(
    `query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) {
       author { login } reviewDecision
       latestOpinionatedReviews(first: 10) { nodes { state author { login } } } } } }`,
    { o: ORG, r: repo, n: number },
  );
  console.log(JSON.stringify(repository.pullRequest, null, 2));
} else if (cmd === "snapshot") {
  const gh = await installation();
  const run = Number(args[0] ?? 1);
  const VALUES = `fieldValues(first: 20) { nodes {
      ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
      ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } } } }`;
  const ITEMS = `projectItems(first: 5) { nodes { project { number } ${VALUES} } }`;
  const COMMENTS = `comments(last: 20) { nodes { author { login } createdAt body } }`;
  const PR = `number title state isDraft merged headRefName url author { login }
    reviews(last: 20) { nodes { state author { login } submittedAt } } ${COMMENTS} ${ITEMS}`;
  // The root, its sub-issues, the PRs on the run's branches in each repo, their
  // reviews, the comments (attempt comments live there) and the Project fields.
  const query = `query($o: String!, $n: Int!) {
    rateLimit { cost remaining limit resetAt }
    root: repository(owner: $o, name: "factory") { issue(number: $n) {
      number title state issueType { name } labels(first: 20) { nodes { name } } ${COMMENTS} ${ITEMS}
      subIssues(first: 50) { nodes { number title state issueType { name } repository { name } ${COMMENTS} ${ITEMS} } } } }
    backend: repository(owner: $o, name: "backend") { pullRequests(first: 20, states: [OPEN, MERGED, CLOSED],
      orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR} } } }
    frontend: repository(owner: $o, name: "frontend") { pullRequests(first: 20, states: [OPEN, MERGED, CLOSED],
      orderBy: {field: CREATED_AT, direction: DESC}) { nodes { ${PR} } } }
  }`;
  const data = await gh.graphql<any>(query, { o: ORG, n: run });
  const prefix = `fab0/${run}/`;
  const prs = [...data.backend.pullRequests.nodes, ...data.frontend.pullRequests.nodes].filter((p: any) => p.headRefName.startsWith(prefix));
  console.log(JSON.stringify({ rateLimit: data.rateLimit, root: data.root.issue.number, subIssues: data.root.issue.subIssues.nodes.length, prs: prs.map((p: any) => p.url) }, null, 2));
} else {
  console.error("usage: bun checks.ts deliveries [n] [event] | delivery <id> | approve <repo> <pr> | snapshot [run]");
  process.exit(2);
}
