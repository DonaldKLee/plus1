import { cacheSchemaAndPolicies } from "./federatoClient.js";
import { rankQueue } from "./rank.js";
import { deepDivePolicy } from "./deepDive.js";
import { runBrowserbaseVerification } from "./browserbaseWork.js";

async function main() {
  const cmd = process.argv[2] ?? "rank";
  if (cmd === "warm" || cmd === "cache") {
    // Pull the schema + expanded property book into this process's memory (nothing on disk).
    const r = await cacheSchemaAndPolicies();
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  if (cmd === "rank") {
    const r = await rankQueue({ refresh: process.argv.includes("--refresh") });
    console.log(
      JSON.stringify(
        {
          generatedAt: r.generatedAt,
          propertyPolicies: r.propertyPolicies,
          queryTrace: r.queryTrace,
          top10: r.ranked.slice(0, 10).map((x) => ({
            rank: x.rank,
            account: x.accountName,
            decision: x.decision,
            score: `${x.score}/${x.maxScore}`,
            premium: x.premium,
            state: x.primaryState,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (cmd === "deep-dive") {
    const id = Number(process.argv[3] ?? 1001);
    const { deepDive, hops } = await deepDivePolicy(id);
    let browse = null;
    if (process.argv.includes("--browse")) {
      browse = await runBrowserbaseVerification({
        address: deepDive.address,
        city: deepDive.city,
        state: deepDive.state,
        zip: deepDive.zip,
      });
    }
    console.log(JSON.stringify({ deepDive, hops, browse }, null, 2));
    return;
  }
  console.error("Usage: cli.ts [warm|rank|deep-dive] [--refresh] [--browse]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
