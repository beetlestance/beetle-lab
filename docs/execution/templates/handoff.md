# Task handoff template

Keep the completed report <=40 lines. Logs/evidence are separate task artifacts.

```text
task: <id and bounded behavior>
result: submitted | partial | blocked
model: <exact id / reasoning effort>
packet: <path + hash>
base: <accepted SHA / contract SHA / relevant input hashes>
result_commits: <SHA list, or named diff artifact>
changed_paths: <allowlisted files>
behavior: <observable before/after, 1-3 lines>
invariants: <key lifecycle/resource/namespace rules exercised>
checks: <command, cwd, source SHA/dirty digest, exit, evidence path>
negative_cases: <acceptance IDs and actual observations>
resources: <declared budget, observations, owned runtime namespaces>
limitations: <failed/skipped/unavailable checks; never hide them>
contract_changes_requested: <none or narrow proposal>
noticed: <out-of-scope issues, unfixed>
cleanup: <owned test resources stopped/retained and why>
```

Coordinator separately appends review/integrated/accepted status with source IDs;
a worker cannot self-award those states. Private credentials/source excerpts are
never part of the report or published evidence.
